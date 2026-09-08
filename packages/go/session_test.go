package axllm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
    "net/http"
    "net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type sessionTestTransport struct {
	mu       sync.Mutex
	requests []Value
	stream   func(context.Context, Value, int) (AxHTTPStreamResponse, error)
}

func (t *sessionTestTransport) Call(context.Context, Value) (Value, error) {
	return nil, fmt.Errorf("session must use incremental HTTP streaming")
}
func (t *sessionTestTransport) Stream(ctx context.Context, request Value) (AxHTTPStreamResponse, error) {
	t.mu.Lock()
	t.requests = append(t.requests, request)
	n := len(t.requests)
	t.mu.Unlock()
	return t.stream(ctx, request, n)
}
func sessionSSE(writer io.Writer, event Value) {
	data, _ := json.Marshal(event)
	_, _ = fmt.Fprintf(writer, "data: %s\n\n", data)
}
func sessionCompleted(id, answer string) Value {
	return Object("type", "response.completed", "response", Object("id", id, "model", "gpt-6-astra", "usage", Object("input_tokens", 3, "output_tokens", 2, "total_tokens", 5), "output", Array(Object("type", "message", "id", "msg-"+id, "content", Array(Object("type", "output_text", "text", answer))))))
}
func TestAstraSessionBackgroundOverlapAndFinalIncorporation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	transport := &sessionTestTransport{}
	transport.stream = func(ctx context.Context, request Value, n int) (AxHTTPStreamResponse, error) {
		payload := coreGet(request, "json", Object())
		if n == 1 {
			tools := asSlice(coreGet(payload, "tools", Array()))
			if len(tools) != 1 || coreGet(tools[0], "async", false) != true {
				return AxHTTPStreamResponse{}, fmt.Errorf("missing async tool declaration: %v", payload)
			}
			reader, writer := io.Pipe()
			go func() {
				defer writer.Close()
				sessionSSE(writer, Object("type", "response.created", "response", Object("id", "r1")))
				sessionSSE(writer, Object("type", "response.function_call_arguments.delta", "delta", "{", "item_id", "i1"))
				if calls.Load() != 0 {
					_ = writer.CloseWithError(fmt.Errorf("partial arguments executed a tool"))
					return
				}
				call := Object("type", "response.output_item.done", "item", Object("type", "function_call", "id", "i1", "call_id", "c1", "name", "lookup", "arguments", "{}"))
				sessionSSE(writer, call)
				sessionSSE(writer, call)
				select {
				case <-started:
					close(release)
				case <-ctx.Done():
					_ = writer.CloseWithError(ctx.Err())
					return
				}
				sessionSSE(writer, sessionCompleted("r1", "{\"answer\":\"provisional\"}"))
			}()
			return AxHTTPStreamResponse{Status: 200, Body: reader}, nil
		}
		if n != 2 {
			return AxHTTPStreamResponse{}, fmt.Errorf("unexpected replay")
		}
		if coreGet(payload, "previous_response_id", "") != "r1" {
			return AxHTTPStreamResponse{}, fmt.Errorf("lost response ID: %v", payload)
		}
		items := asSlice(coreGet(payload, "input", Array()))
		if len(items) != 1 || coreGet(items[0], "call_id", "") != "c1" || coreGet(items[0], "output", "") != "REF-42" {
			return AxHTTPStreamResponse{}, fmt.Errorf("result not incorporated exactly once: %v", items)
		}
		var body strings.Builder
		sessionSSE(&body, sessionCompleted("r2", "{\"answer\":\"REF-42\"}"))
		return AxHTTPStreamResponse{Status: 200, Body: io.NopCloser(strings.NewReader(body.String()))}, nil
	}
	client := NewAI("openai", Object("api_key", "test", "model", "gpt-6-astra", "transport", transport, "model_config", Object("thinkingTokenBudget", "low")))
    client=NewProviderRouter(Object("providers",Object("primary",client)))
	program := NewAx("question -> answer", nil)
	program.Functions = []Tool{Fn("lookup").Execution("background").WithContextHandler(func(ctx context.Context, args map[string]Value) (Value, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return "REF-42", nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := program.Forward(ctx, client, Object("question", "Find reference"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if coreGet(result, "answer", "") != "REF-42" {
		t.Fatalf("provisional output escaped: %v", result)
	}
	if calls.Load() != 1 {
		t.Fatalf("tool executed %d times", calls.Load())
	}
}

func TestAstraSessionCancellationDiscardsLateWork(t *testing.T) {
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	readerClosed := make(chan struct{})
	transport := &sessionTestTransport{}
	transport.stream = func(ctx context.Context, request Value, n int) (AxHTTPStreamResponse, error) {
		if n != 1 {
			return AxHTTPStreamResponse{}, fmt.Errorf("work was replayed")
		}
		reader, writer := io.Pipe()
		go func() {
			defer close(readerClosed)
			defer writer.Close()
			sessionSSE(writer, Object("type", "response.created", "response", Object("id", "r1")))
			sessionSSE(writer, Object("type", "response.output_item.done", "item", Object("type", "function_call", "id", "i1", "call_id", "pending-call", "name", "external", "arguments", "{}")))
			// Hold the transport at a real blocking read until cancellation.
			<-ctx.Done()
		}()
		return AxHTTPStreamResponse{Status: 200, Body: reader}, nil
	}
	client := NewAI("openai", Object("api_key", "test", "model", "gpt-6-astra", "transport", transport))
	program := NewAx("question -> answer", nil)
	program.Functions = []Tool{Fn("external").Execution("background").WithHandler(func(args map[string]Value) (Value, error) {
		close(started)
		<-release
		close(finished)
		return "late action completed", nil
	})}
	control := RunControl()
	result := make(chan error, 1)
	go func() {
		_, err := program.Forward(context.Background(), client, Object("question", "Do work"), Object("control", control))
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("tool not started")
	}
	control.Abort()
	select {
	case err := <-result:
		if err == nil || !strings.Contains(err.Error(), "pending-call") {
			t.Fatalf("missing unresolved work: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("abort waited for noncooperative tool")
	}
	select {
	case <-readerClosed:
	case <-time.After(time.Second):
		t.Fatal("transport did not close")
	}
    unresolved:=asSlice(program.FunctionCallTraces)
    if len(unresolved)!=1||display(coreGet(unresolved[0],"id",nil))!="pending-call"||display(coreGet(unresolved[0],"status",nil))!="unresolved"{t.Fatalf("Unresolved action missing: %v",unresolved)}
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("late tool lost ownership")
	}
	transport.mu.Lock()
	requests := len(transport.requests)
	transport.mu.Unlock()
	if requests != 1 {
		t.Fatalf("late work triggered %d requests", requests)
	}
}

func TestSessionContextHandlerValidatesReturns(t *testing.T) {
	tool := Fn("validated").WithContextHandler(func(context.Context, map[string]Value) (Value, error) {
		return Object("value", "not a number"), nil
	})
	tool.Returns = map[string]Field{"value": {Name: "value", Type: FieldType{Name: "number"}}}
	if _, err := tool.invokeContext(context.Background(), Object()); err == nil {
		t.Fatal("cancellation-aware handler bypassed return validation")
	}
}

func TestAstraFlowSessionIsolationAndFutureRootUpdates(t *testing.T) {
	var calls atomic.Int32
	control := RunControl()
	var applied []string
	control.OnEvent(func(event map[string]Value) {
		if coreGet(event, "type", "") == "applied" {
			applied = append(applied, display(coreGet(event, "path", "")))
		}
	})
	control.Steer("Keep the reference exact.")
	transport := &sessionTestTransport{}
	transport.stream = func(ctx context.Context, request Value, n int) (AxHTTPStreamResponse, error) {
		body := coreGet(request, "json", Object())
		if coreGet(body, "model", "") != "gpt-6-astra" {
			return AxHTTPStreamResponse{}, fmt.Errorf("alias was not resolved")
		}
		var event Value
		if n%2 == 1 {
			if coreGet(body, "previous_response_id", nil) != nil {
				return AxHTTPStreamResponse{}, fmt.Errorf("node inherited another conversation")
			}
			event = Object("type", "response.completed", "response", Object("id", "node-start", "model", "gpt-6-astra", "output", Array(Object("type", "function_call", "id", "item", "call_id", "same-call", "name", "lookup", "arguments", "{\"query\":\"REF-42\"}"))))
		} else {
			if coreGet(body, "previous_response_id", "") != "node-start" {
				return AxHTTPStreamResponse{}, fmt.Errorf("lost node response ID")
			}
			input := asSlice(coreGet(body, "input", Array()))
			if len(input) != 2 || coreGet(input[0], "role", "") != "user" || coreGet(input[1], "call_id", "") != "same-call" || coreGet(input[1], "output", "") != "REF-42" {
				return AxHTTPStreamResponse{}, fmt.Errorf("lost scoped update or result: %v", input)
			}
			event = sessionCompleted("node-final", "{\"answer\":\"REF-42\"}")
		}
		var bodyStream strings.Builder
		sessionSSE(&bodyStream, event)
		return AxHTTPStreamResponse{Status: 200, Body: io.NopCloser(strings.NewReader(bodyStream.String()))}, nil
	}
	client := NewAI("openai", Object("api_key", "test", "model", "gpt-6-astra", "transport", transport))
	routed, routeErr := NewMultiServiceRouter([]Value{RouterServiceEntry{Key: "smart", Service: client.(AxAIService)}})
	if routeErr != nil {
		t.Fatal(routeErr)
	}
	if !coreTruthy(routed.GetFeatures("smart")["asyncTools"]) {
		t.Fatal("alias capabilities")
	}
	client = routed
	tool := Fn("lookup").Execution("background").WithHandler(func(args map[string]Value) (Value, error) { calls.Add(1); return args["query"], nil })
	tool.Args = map[string]Field{"query": {Name: "query", Type: FieldType{Name: "string"}}}
	first, second := NewAx("question -> answer", nil), NewAx("question -> answer", nil)
	first.Functions = []Tool{tool}
	second.Functions = []Tool{tool}
	workflow := NewFlow(nil).Execute("first", first, nil).Execute("second", second, nil).Returns(Object("first", "firstResult", "second", "secondResult"))
	for i := 0; i < 2; i++ {
		result, err := workflow.Forward(context.Background(), client, Object("question", "Find reference"), Object("control", control, "model", "smart"))
		if err != nil {
			t.Fatal(err)
		}
		if coreGet(coreGet(result, "first", Object()), "answer", "") != "REF-42" || coreGet(coreGet(result, "second", Object()), "answer", "") != "REF-42" {
			t.Fatal(result)
		}
	}
	if len(transport.requests) != 8 || calls.Load() != 4 || strings.Join(applied, ",") != "root/first,root/second,root/first,root/second" {
		t.Fatalf("flow isolation: requests=%d calls=%d paths=%v", len(transport.requests), calls.Load(), applied)
	}
	control.OnEvent(func(event map[string]Value) {
		if event["type"] == "completed" && event["path"] == "root/first" {
			control.Abort()
		}
	})
	_, err := workflow.Forward(context.Background(), client, Object("question", "Find reference"), Object("control", control, "model", "smart"))
	if err == nil || !strings.Contains(err.Error(), "Flow aborted") {
		t.Fatalf("aborted flow: %v", err)
	}
	if len(transport.requests) != 10 || calls.Load() != 5 {
		t.Fatal("aborted flow started another node")
	}

}

type steeringTestSocket struct {
	inbound chan Value
	done    chan struct{}
	once    sync.Once
	mu      sync.Mutex
	sent    []Value
}

func (s *steeringTestSocket) Send(event Value) {
	s.mu.Lock()
	s.sent = append(s.sent, cloneValue(event))
	s.mu.Unlock()
	if coreGet(event, "type", "") == "response.create" {
		if _, ok := asMap(event)["stream"]; ok {
			panic(fmt.Errorf("WebSocket create retained stream"))
		}
		s.inbound <- Object("type", "response.created", "response", Object("id", "parent"))
		s.inbound <- Object("type", "response.output_text.delta", "delta", "provisional")
	} else {
		if coreGet(event, "type", "") != "response.steer" || coreGet(event, "previous_response_id", "") != "parent" {
			panic(fmt.Errorf("invalid steer: %v", event))
		}
		ack := Object("type", "response.steer.accepted", "steer", Object("id", "s1", "previous_response_id", "parent"))
		s.inbound <- ack
		s.inbound <- ack
		s.inbound <- Object("type", "response.incomplete", "response", Object("id", "parent", "model", "gpt-6-astra", "incomplete_details", Object("reason", "steered"), "output", Array(), "usage", Object("input_tokens", 3, "output_tokens", 2)))
		s.inbound <- Object("type", "response.created", "response", Object("id", "successor"))
		s.inbound <- sessionCompleted("successor", "{\"answer\":\"CORRECTED\"}")
	}
}
func (s *steeringTestSocket) Recv() (Value, bool) {
	select {
	case v := <-s.inbound:
		return v, true
	case <-s.done:
		return nil, false
	}
}
func (s *steeringTestSocket) Close() { s.once.Do(func() { close(s.done) }) }
func TestAstraSessionNativeSteeringSuccessor(t *testing.T) {
	socket := &steeringTestSocket{inbound: make(chan Value, 16), done: make(chan struct{})}
	control := RunControl()
	steered := false
	applied := 0
	control.OnEvent(func(event map[string]Value) {
		if coreGet(event, "type", "") == "model.output" && !steered {
			steered = true
			_ = control.Steer("Use CORRECTED.")
		}
		if coreGet(event, "type", "") == "applied" {
			if coreGet(event, "timing", "") != "native" {
				t.Error("steering was replayed")
			}
			applied++
		}
	})
	factory := AxSessionWebSocketFactory(func(ctx context.Context, target string, headers map[string]Value) (RealtimeTransport, error) {
		if target != "wss://example.test/v1/responses" || coreGet(headers, "Authorization", "") != "Bearer test" {
			return nil, fmt.Errorf("lost configured socket endpoint or authentication")
		}
		return socket, nil
	})
	client := NewAI("openai", Object("api_key", "test", "model", "gpt-6-astra", "base_url", "https://example.test/v1", "webSocketFactory", factory))
	program := NewAx("question -> answer", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := program.Forward(ctx, client, Object("question", "Find answer"), Object("control", control))
	if err != nil {
		t.Fatal(err)
	}
	if coreGet(result, "answer", "") != "CORRECTED" || applied != 1 {
		t.Fatalf("invalid final result or acknowledgements: %v %d", result, applied)
	}
	socket.mu.Lock()
	count := len(socket.sent)
	socket.mu.Unlock()
	if count != 2 {
		t.Fatalf("unexpected replay: %d", count)
	}
	select {
	case <-socket.done:
	default:
		t.Fatal("socket left open")
	}
	logs := asSlice(program.ChatLog)
	if len(logs) != 2 || coreGet(logs[0], "remote_id", "") != "parent" || coreGet(logs[1], "remote_id", "") != "successor" {
		t.Fatalf("lost response accounting: %v", logs)
	}
}

type agentSessionTransport struct {
	mu               sync.Mutex
	requests         int
	started, release chan struct{}
}

func (t *agentSessionTransport) next(request Value) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.requests++
	return t.requests
}
func (t *agentSessionTransport) Call(ctx context.Context, request Value) (Value, error) {
	n := t.next(request)
	body := coreGet(request, "json", Object())
	for _, tool := range asSlice(coreGet(body, "tools", Array())) {
		if coreTruthy(coreGet(tool, "async", false)) {
			return nil, fmt.Errorf("actor authority leaked to another stage")
		}
	}
	if n == 1 {
		return coreGet(sessionCompleted("distiller", "{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}"), "response", nil), nil
	}
	if n != 4 || !strings.Contains(stableStringify(body), "REF-42") {
		return nil, fmt.Errorf("responder ran before final result incorporation: %d", n)
	}
	return coreGet(sessionCompleted("responder", "{\"answer\":\"REF-42\"}"), "response", nil), nil
}
func (t *agentSessionTransport) Stream(ctx context.Context, request Value) (AxHTTPStreamResponse, error) {
	n := t.next(request)
	body := coreGet(request, "json", Object())
    if n==1||n==2||n==5||n==6 {
        for _,tool:=range asSlice(coreGet(body,"tools",Array())){if coreTruthy(coreGet(tool,"async",false)){return AxHTTPStreamResponse{},fmt.Errorf("Actor authority leaked")}}
        stage:="distiller";text:="{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}";if n>=5{stage="responder";text="{\"answer\":\"REF-42\"}"}
        suffix:="-start";if n==2||n==6 {suffix="-final";input:=stableStringify(coreGet(body,"input",nil));if coreGet(body,"previous_response_id","")!=stage+"-start"||!strings.Contains(input,"ROOT-GUIDANCE")||strings.Contains(input,"RESPONDER-ONLY")!=(n==6){return AxHTTPStreamResponse{},fmt.Errorf("Scoped stage update mismatch: %v",body)}}
        if n==5&&!strings.Contains(stableStringify(body),"REF-42"){return AxHTTPStreamResponse{},fmt.Errorf("Responder started before incorporation")}
        var out strings.Builder;sessionSSE(&out,sessionCompleted(stage+suffix,text));return AxHTTPStreamResponse{Status:200,Body:io.NopCloser(strings.NewReader(out.String()))},nil
    }
	if n == 3 {
		tools := asSlice(coreGet(body, "tools", Array()))
		if len(tools) != 1 || coreGet(tools[0], "name", "") != "tools_lookup" || coreGet(tools[0], "async", false) != true {
			return AxHTTPStreamResponse{}, fmt.Errorf("missing native actor tool: %v", tools)
		}
		reader, writer := io.Pipe()
		go func() {
			defer writer.Close()
			sessionSSE(writer, Object("type", "response.output_item.done", "item", Object("type", "function_call", "id", "item", "call_id", "agent-call", "name", "tools_lookup", "arguments", "{\"query\":\"REF-42\"}")))
			select {
			case <-t.started:
				close(t.release)
			case <-ctx.Done():
				_ = writer.CloseWithError(ctx.Err())
				return
			}
			sessionSSE(writer, sessionCompleted("executor1", "{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"))
		}()
		return AxHTTPStreamResponse{Status: 200, Body: reader}, nil
	}
	if n != 4 || coreGet(body, "previous_response_id", "") != "executor1" || !strings.Contains(stableStringify(coreGet(body, "input", nil)), "REF-42") {
		return AxHTTPStreamResponse{}, fmt.Errorf("lost native result: %v", body)
	}
    input:=stableStringify(coreGet(body,"input",nil));if !strings.Contains(input,"ROOT-GUIDANCE")||strings.Contains(input,"RESPONDER-ONLY")||!strings.Contains(input,"configuration_update")||!strings.Contains(input,"medium"){return AxHTTPStreamResponse{},fmt.Errorf("Missing executor update: %v",body)}
	var out strings.Builder
	sessionSSE(&out, sessionCompleted("executor2", "{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"))
	return AxHTTPStreamResponse{Status: 200, Body: io.NopCloser(strings.NewReader(out.String()))}, nil
}
func TestAstraAgentNativeToolsAndActionLog(t *testing.T) {
	transport := &agentSessionTransport{started: make(chan struct{}), release: make(chan struct{})}
	control:=RunControl();_ = control.Steer("ROOT-GUIDANCE");_ = control.Steer("RESPONDER-ONLY","root/responder");_ = control.SetThinkingTokenBudget("medium","root/executor")
	var calls atomic.Int32
	tool := Fn("lookup").Execution("background").WithContextHandler(func(ctx context.Context, args map[string]Value) (Value, error) {
		calls.Add(1)
		close(transport.started)
		select {
		case <-transport.release:
			return args["query"], nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	tool.Description = "Lookup"
	tool.Args = map[string]Field{"query": {Name: "query", Type: FieldType{Name: "string"}}}
	program := NewAgent("question -> answer", Object("functions", Array(tool), "directResponse", "off"))
	client := NewAI("openai", Object("api_key", "test", "model", "gpt-6-astra", "transport", transport))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := program.Forward(ctx, client, Object("question", "Find reference"), Object("control",control))
	if err != nil {
		t.Fatal(err)
	}
	if coreGet(result, "answer", "") != "REF-42" || calls.Load() != 1 {
		t.Fatalf("invalid final result: %v", result)
	}
	activity := []Value{}
	for _, entry := range asSlice(program.GetActionLog()) {
		if coreGet(entry, "type", "") == "function_call" {
			activity = append(activity, entry)
		}
	}
	if len(activity) != 1 || coreGet(activity[0], "qualified_name", "") != "tools.lookup" {
		t.Fatalf("lost native activity: %v", activity)
	}
	traces := asSlice(coreGet(program.State, "function_call_traces", Array()))
	if len(traces) != 1 || coreGet(traces[0], "call_id", "") != "agent-call" {
		t.Fatalf("lost call accounting: %v", traces)
	}
	duplicate := program.InvokeCallable("tools.lookup", Object("query", "REF-42"), Object())
	if coreGet(duplicate, "status", "") != "error" || calls.Load() != 1 {
		t.Fatal("native tool ran again through actor machinery")
	}
}

type balancedChatOnlyService struct { AxAIService; calls int; tools *atomic.Int32; unused bool }
func (s *balancedChatOnlyService) GetFeatures(model string) map[string]Value {
    features:=cloneMap(s.AxAIService.GetFeatures(model));features["asyncTools"]=s.unused;return features
}
func (s *balancedChatOnlyService) Chat(ctx context.Context,request,options map[string]Value)(Value,error) {
    if s.unused{return nil,fmt.Errorf("pinned run changed providers")};s.calls++
    if s.calls==1{return Object("results",Array(Object("function_calls",Array(Object("id","balanced-call","function",Object("name","lookup","params",Object())))))),nil}
    if s.calls!=2||s.tools.Load()!=1||!strings.Contains(display(request),"FALLBACK")||!strings.Contains(display(request),"balanced-call"){return nil,fmt.Errorf("lost tool continuation: %v",request)}
    return Object("results",Array(Object("content","{\"answer\":\"FALLBACK\"}"))),nil
}
func TestAstraMixedBalancerPinsChatOnlyFallback(t *testing.T) {
    var called atomic.Int32
    ordinary:=&balancedChatOnlyService{AxAIService:NewAI("openai",Object("api_key","test","model","gpt-6-astra")).(AxAIService),tools:&called}
    unused:=&balancedChatOnlyService{AxAIService:NewAI("openai",Object("api_key","test","model","gpt-6-astra")).(AxAIService),tools:&called,unused:true}
    client,err:=NewAxBalancer([]AxAIService{ordinary,unused},Object("strategy","input_order"));if err!=nil{t.Fatal(err)}
    program:=NewAx("question -> answer",nil);program.Functions=[]Tool{Fn("lookup").Execution("background").WithHandler(func(map[string]Value)(Value,error){called.Add(1);return "FALLBACK",nil})}
    result,err:=program.Forward(context.Background(),client,Object("question","Lookup"),Object());if err!=nil{t.Fatal(err)}
    if coreGet(result,"answer","")!="FALLBACK"||ordinary.calls!=2||unused.calls!=0||called.Load()!=1{t.Fatalf("invalid pinned result: %v",result)}
}

func TestAstraSessionInvalidArgumentsAndStepExhaustion(t *testing.T) {
 for _, exhausted := range []bool{false,true} { for _, rawArguments := range []string{`{}`,`{"query":"ab"}`} { t.Run(fmt.Sprint(exhausted,rawArguments),func(t *testing.T){
  var calls atomic.Int32
  transport:=&sessionTestTransport{}
  transport.stream=func(ctx context.Context,request Value,n int)(AxHTTPStreamResponse,error){
   if coreGet(coreGet(request,"json",Object()),"temperature",nil)!=nil{return AxHTTPStreamResponse{},fmt.Errorf("Astra leaked temperature: %v",coreGet(request,"json",Object()))}
   var event Value
   if n==1 {event=Object("type","response.completed","response",Object("id","invalid","model","gpt-6-astra","output",Array(Object("type","function_call","id","invalid-item","call_id","invalid-call","name","validated_lookup","arguments",rawArguments))))
   }else{
    if exhausted||n!=2 {return AxHTTPStreamResponse{},fmt.Errorf("work replayed after step exhaustion")}
    body:=coreGet(request,"json",Object());outputs:=asSlice(coreGet(body,"input",Array()))
    if coreGet(body,"previous_response_id",nil)!="invalid"||len(outputs)!=1||coreGet(outputs[0],"call_id",nil)!="invalid-call"||!strings.Contains(strings.ToLower(display(coreGet(outputs[0],"output",""))),"query") {return AxHTTPStreamResponse{},fmt.Errorf("invalid correction continuation: %v",body)}
    event=sessionCompleted("corrected",`{"answer":"CORRECTED"}`)
   }
   var data strings.Builder;sessionSSE(&data,event)
   return AxHTTPStreamResponse{Status:200,Body:io.NopCloser(strings.NewReader(data.String()))},nil
  }
  client:=NewAI("openai",Object("api_key","test","model","gpt-6-astra","transport",transport))
  tool:=Fn("validated_lookup").Execution("background").WithHandler(func(args map[string]Value)(Value,error){calls.Add(1);return "unexpected",nil})
  tool.Args["query"]=Field{Name:"query",Type:FieldType{Name:"string"}}
  tool.Parameters = parseJSON("{\"type\":\"object\",\"$defs\":{\"query\":{\"type\":\"string\",\"minLength\":3,\"pattern\":\"^[A-Z]+$\"}},\"properties\":{\"query\":{\"$ref\":\"#/$defs/query\"}},\"required\":[\"query\"],\"additionalProperties\":false}")
  program:=NewAx("question -> answer",nil);program.Functions=[]Tool{tool}
  steps:=3;if exhausted{steps=1}
  result,err:=program.Forward(context.Background(),client,Object("question","Find reference"),Object("maxSteps",steps))
  if exhausted {if err==nil||!strings.Contains(err.Error(),"steps"){t.Fatalf("expected exhaustion, got %v %v",result,err)}}else if err!=nil||coreGet(result,"answer",nil)!="CORRECTED"{t.Fatalf("correction failed: %v %v",result,err)}
  expected:=2;if exhausted{expected=1};if calls.Load()!=0||len(transport.requests)!=expected{t.Fatalf("invalid execution or replay: %d %d",calls.Load(),len(transport.requests))}
 })}}
}

type nativeFileTransport struct { requests []Value }
func (t *nativeFileTransport) Call(_ context.Context, request Value) (Value,error) {
    t.requests=append(t.requests,coreGet(request,"json",nil))
    return Object("status",200,"json",Object("id","file-response","choices",Array(Object("index",0,"message",Object("role","assistant","content","{\"summary\":\"Read\"}"))))),nil
}
func TestNativeFileRouterBalancerHistory(t *testing.T) {
    transport:=&nativeFileTransport{}
    client:=NewAI("openai",Object("api_key","test","model","gpt-5.6","transport",transport))
    balancer,err:=NewAxBalancer([]AxAIService{client.(AxAIService)},Object("strategy","input_order"));if err!=nil{t.Fatal(err)}
    router:=NewProviderRouter(Object("providers",Object("primary",balancer),"processing",Object("fileToText",AxFileToText(func(string,string)(string,error){t.Fatal("native file extracted");return "",nil}))))
    file:=Object("type","file","filename","report.pdf","mimeType","application/pdf","data","JVBERi0=","cache",true,"extractedText","fallback")
    message:=Object("role","user","content",Array(Object("type","text","text","Read"),file,Object("type","text","text","Summarize")))
    original,_:=json.Marshal(message)
    request:=Object("chat_prompt",Array(message),"model_config",Object("stream",false))
    if _,err=router.Chat(context.Background(),request,nil);err!=nil{t.Fatal(err)}
    request["chat_prompt"]=Array(message,Object("role","assistant","content","Read"),Object("role","user","content","Continue"))
    if _,err=router.Chat(context.Background(),request,nil);err!=nil{t.Fatal(err)}
    after,_:=json.Marshal(message);if string(after)!=string(original){t.Fatal("retained history mutated")}
    for _,body:=range transport.requests {
        parts:=asSlice(coreGet(asSlice(coreGet(body,"messages",nil))[0],"content",nil))
        fileBody:=coreGet(parts[1],"file",nil)
        if coreGet(fileBody,"filename",nil)!="report.pdf"||coreGet(fileBody,"file_data",nil)!="data:application/pdf;base64,JVBERi0="||coreGet(parts[0],"text",nil)!="Read"||coreGet(parts[2],"text",nil)!="Summarize"{t.Fatalf("native file or ordering lost: %v",parts)}
    }
    if len(transport.requests)!=2{t.Fatal("unexpected replay")}
    result,err:=NewAx("document:file -> summary:string",nil).Forward(context.Background(),router,Object("document",file),nil)
    if err!=nil||coreGet(result,"summary",nil)!="Read"||len(transport.requests)!=3{t.Fatalf("router lost generator completion: %v %v",result,err)}
}

func TestFileExtractionCallback(t *testing.T) {
 transport:=&nativeFileTransport{}
 client:=NewAI("deepseek",Object("api_key","test","model","deepseek-v4-flash","transport",transport))
 calls:=0
 router:=NewProviderRouter(Object("providers",Object("primary",client),"processing",Object("fileToText",AxFileToText(func(data,mime string)(string,error){calls++;if data!="JVBERi0="||mime!="application/pdf"{t.Fatal("extraction arguments lost")};return "",nil}))))
 request:=Object("chat_prompt",Array(Object("role","user","content",Array(Object("type","file","data","JVBERi0=","mimeType","application/pdf")))))
 if _,err:=router.Chat(context.Background(),request,nil);err!=nil{t.Fatal(err)}
 if calls!=1||coreGet(asSlice(coreGet(transport.requests[0],"messages",nil))[0],"content",nil)!=""{t.Fatal("empty extraction was lost")}
 router.processing["fileToText"]=AxFileToText(func(string,string)(string,error){return "",fmt.Errorf("extractor failed")})
 if _,err:=router.Chat(context.Background(),request,nil);err==nil||!strings.Contains(err.Error(),"extractor failed"){t.Fatalf("extraction error lost: %v",err)}
 if len(transport.requests)!=1{t.Fatal("failed extraction reached transport")}
 delete(router.processing,"fileToText");router.processing["fallbackBehavior"]="error"
 if _,err:=router.Chat(context.Background(),request,nil);err==nil||!strings.Contains(err.Error(),"Files are not supported"){t.Fatalf("error policy lost: %v",err)}
 if len(transport.requests)!=1{t.Fatal("unsupported file reached transport")}
}

func TestOwnedFlowWorkersOverlap(t *testing.T) {
    var started atomic.Int32
    release := make(chan struct{})
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request) {
        if r.Header.Get("Authorization") != "Bearer worker-test" { t.Error("worker lost configured authentication") }
        if started.Add(1)==2 {close(release)}
        select {case <-release: case <-r.Context().Done(): return; case <-time.After(3*time.Second): http.Error(w,"parallel nodes did not overlap",500);return}
        w.Header().Set("Content-Type","application/json")
        fmt.Fprint(w,`{"id":"reply","choices":[{"index":0,"message":{"role":"assistant","content":"{\"answer\":\"DONE\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`)
    }))
    defer server.Close()
    client := NewAI("openai",Object("api_key","worker-test","model","gpt-5.6","base_url",server.URL))
    balancer,err:=NewAxBalancer([]AxAIService{client.(AxAIService)},Object("strategy","input_order"));if err!=nil{t.Fatal(err)}
    aliases,err:=NewMultiServiceRouter([]Value{RouterServiceEntry{Key:"smart",Service:balancer}});if err!=nil{t.Fatal(err)}
    router:=NewProviderRouter(Object("providers",Object("primary",aliases)))
    first,second := NewAx("question -> answer",nil),NewAx("question -> answer",nil)
    workflow := NewFlow(nil).Execute("first",first,nil).Execute("second",second,nil).Returns(Object("first","firstResult","second","secondResult"))
    ctx,cancel := context.WithTimeout(context.Background(),5*time.Second);defer cancel()
    result,err := workflow.Forward(ctx,router,Object("question","Ready"),Object("stream",false,"model","smart"))
    if err != nil {t.Fatal(err)}
    if started.Load()!=2 {t.Fatalf("expected two requests, got %d",started.Load())}
    if display(coreGet(coreGet(result,"first",nil),"answer",""))!="DONE" || display(coreGet(coreGet(result,"second",nil),"answer",""))!="DONE" {t.Fatalf("incorrect parallel results: %v",result)}
    if len(coreIter(coreGet(workflow.State,"chat_log",Array())))!=2 {t.Fatalf("missing independent histories: %v",workflow.State)}
}
type flowFailureGate struct {started atomic.Int32; all chan struct{}; release chan struct{}; fast chan struct{}; late chan struct{}; once sync.Once}
type flowFailureTransport struct {gate *flowFailureGate}
func (t *flowFailureTransport) OwnedWorkerFactory() func() Transport {return func() Transport{return &flowFailureTransport{t.gate}}}
func (t *flowFailureTransport) Call(_ context.Context,request Value)(Value,error){
    body,_:=json.Marshal(coreGet(request,"json",nil));if t.gate.started.Add(1)==3{close(t.gate.all)}
    select{case <-t.gate.all:case <-time.After(3*time.Second):return nil,fmt.Errorf("parallel requests did not overlap")}
    content:=`{"fastAnswer":"DONE"}`
    if strings.Contains(string(body),"lateAnswer"){select{case <-t.gate.release:case <-time.After(3*time.Second):return nil,fmt.Errorf("late worker not released")};content=`{"lateAnswer":"LATE"}`;defer close(t.gate.late)
    }else if strings.Contains(string(body),"failAnswer"){select{case <-t.gate.fast:case <-time.After(3*time.Second):return nil,fmt.Errorf("completed sibling was not reported")};content=`{"wrong":"invalid"}`}
    return Object("status",200,"json",Object("id","reply","choices",Array(Object("index",0,"message",Object("role","assistant","content",content),"finish_reason","stop")))),nil
}
func TestOwnedFlowFailureDiscardsLateWork(t *testing.T){
    gate:=&flowFailureGate{all:make(chan struct{}),release:make(chan struct{}),fast:make(chan struct{}),late:make(chan struct{})};defer gate.once.Do(func(){close(gate.release)})
    control:=RunControl();var completed sync.Once;control.OnEvent(func(event map[string]Value){if event["type"]=="completed"&&event["path"]=="root/fast"{completed.Do(func(){close(gate.fast)})}})
    client:=NewAI("openai",Object("api_key","test","model","gpt-5.6","transport",&flowFailureTransport{gate}))
    workflow:=NewFlow(nil).Execute("fast",NewAx("question -> fastAnswer",nil),nil).Execute("fail",NewAx("question -> failAnswer",nil),nil).Execute("late",NewAx("question -> lateAnswer",nil),nil)
    started:=time.Now();_,err:=workflow.Forward(context.Background(),client,Object("question","Ready"),Object("control",control,"stream",false,"maxSteps",1,"validationRetries",0,"infraRetries",0))
    if err==nil||!strings.Contains(err.Error(),"late"){t.Fatalf("failed group returned incorrect outcome: %v",err)}
    if time.Since(started)>2*time.Second{t.Fatal("flow waited for noncooperative worker")}
    completedState:=coreGet(workflow.State,"completed_state",nil);if coreGet(coreGet(completedState,"fastResult",nil),"fastAnswer",nil)!="DONE"{t.Fatalf("lost completed sibling: %v",workflow.State)}
    snapshot,_:=json.Marshal(completedState);gate.once.Do(func(){close(gate.release)})
    select{case <-gate.late:case <-time.After(3*time.Second):t.Fatal("late worker did not finish")}
    after,_:=json.Marshal(coreGet(workflow.State,"completed_state",nil));if string(after)!=string(snapshot)||gate.started.Load()!=3{t.Fatal("late delivery changed state or requests were replayed")}
}

// Exercise native tool invocations concurrently through the MCP request path.
// The transport coordinates overlap and records IDs without introducing its own races.
type concurrentMCPTransport struct {
    AxMCPTransport
    mu sync.Mutex
    requests []Value
    arrived chan struct{}
    release chan struct{}
}
func (t *concurrentMCPTransport) SetMessageHandler(handler func(map[string]Value)) {}
func (t *concurrentMCPTransport) SetLifecycleHandler(handler func(string)) {}
func (t *concurrentMCPTransport) SendWithHeaders(message map[string]Value, headers map[string]string)(map[string]Value,error){
    if message["method"]=="server/discover"{return Object("result",Object("resultType","complete","supportedVersions",Array("2026-07-28"),"ttlMs",60000,"cacheScope","private","capabilities",Object("tools",Object()))),nil}
    if message["method"]=="initialize"{return Object("result",Object("protocolVersion","2025-11-25","serverInfo",Object("name","orders","version","1"),"capabilities",Object("tools",Object()))),nil}
    if message["method"]=="tools/list"{return Object("result",Object("tools",Array(Object("name","lookup","inputSchema",Object("type","object","properties",Object("index",Object("type","integer"))))))),nil}
    t.mu.Lock();t.requests=append(t.requests,cloneValue(message));t.mu.Unlock()
    t.arrived<-struct{}{}
    select{case <-t.release:case <-time.After(3*time.Second):return nil,fmt.Errorf("Native MCP calls did not overlap")}
    return Object("jsonrpc","2.0","id",message["id"],"result",Object("resultType","complete","_meta",Object("io.modelcontextprotocol/serverInfo",Object("name","orders","version",display(message["id"]))),"structuredContent",coreGet(coreGet(message,"params",nil),"arguments",nil))),nil
}
func TestConcurrentNativeMCPRequestIDs(t *testing.T){
    const count=32
    transport:=&concurrentMCPTransport{AxMCPTransport:NewAxMCPScriptedTransport(nil),arrived:make(chan struct{},count),release:make(chan struct{})}
    server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
        var message map[string]Value
        if err:=json.NewDecoder(r.Body).Decode(&message);err!=nil{http.Error(w,err.Error(),400);return}
        if r.Header.Get("Authorization")!="Bearer mcp-worker-test"||r.Header.Get("MCP-Protocol-Version")!="2026-07-28"||r.Header.Get("Mcp-Method")!=display(message["method"]){t.Error("MCP worker lost configured authentication or protocol headers")}
        result,err:=transport.SendWithHeaders(message,nil);if err!=nil{http.Error(w,err.Error(),500);return};w.Header().Set("Content-Type","application/json");_ = json.NewEncoder(w).Encode(result)
    }));defer server.Close()
    httpTransport,err:=NewAxMCPStreamableHTTPTransport(server.URL,Object("authorization","Bearer mcp-worker-test","ssrfProtection",Object("allowLocalhost",true,"requireHttps",false)))
    if err!=nil{t.Fatal(err)}
    client:=NewAxMCPClient(httpTransport,Object("era","modern","namespace","orders"))
    if err:=client.Init();err!=nil{t.Fatal(err)}
    native:=client.NativeTools()[0].Execution("background")
    results:=make(chan Value,count)
    for index:=0;index<count;index++ {go func(index int){value,err:=native.invoke(Object("index",index));if err!=nil{results<-err}else{results<-value}}(index)}
    for index:=0;index<count;index++ {select{case <-transport.arrived:case <-time.After(3*time.Second):close(transport.release);t.Fatal("Native calls did not overlap")}}
    close(transport.release)
    seenResults:=map[int]bool{}
    for index:=0;index<count;index++ {value:=<-results;if err,ok:=value.(error);ok{t.Fatal(err)};seenResults[int(num(coreGet(coreGet(value,"structuredContent",nil),"index",-1)))]=true}
    if len(seenResults)!=count{t.Fatalf("Lost tool results: %v",seenResults)}
    ids:=map[string]bool{}
    for _,request:=range transport.requests{id:=display(coreGet(request,"id",""));if id==""||ids[id]{t.Fatalf("Duplicate native MCP request ID: %v",request)};ids[id]=true;if coreGet(coreGet(request,"params",nil),"name","")!="lookup"{t.Fatal("Native callable changed tool identity")}}
    if len(ids)!=count{t.Fatal("Missing native MCP requests")}
}

type ownedFailingTransport struct { calls *atomic.Int32 }
func(t *ownedFailingTransport) OwnedWorkerFactory() func() Transport{return func()Transport{return &ownedFailingTransport{t.calls}}}
func(t *ownedFailingTransport) Call(context.Context,Value)(Value,error){t.calls.Add(1);return Object("status",429,"json",Object("error",Object("message","fixture rate limit"))),nil}
func TestOwnedBalancerFailureAccounting(t *testing.T){
    calls:=&atomic.Int32{};client:=NewAI("openai",Object("api_key","test","model","gpt-5.6","transport",&ownedFailingTransport{calls}))
    owner,err:=NewAxBalancer([]AxAIService{client.(AxAIService)},Object("maxRetries",1,"initialBackoffMs",0));if err!=nil{t.Fatal(err)}
    worker:=owner.OwnedWorkerFactory()();request:=Object("chat_prompt",Array(Object("role","user","content","Hello")),"model_config",Object("stream",false))
    if _,err:=worker.Chat(context.Background(),request,nil);err==nil{t.Fatal("Failed route returned success")};first:=calls.Load();if first==0{t.Fatal("No provider request")}
    if _,err:=owner.Chat(context.Background(),request,nil);err==nil{t.Fatal("Failed parent route returned success")};if calls.Load()!=first{t.Fatal("Parent forgot worker failure and replayed route")}
}

type nativeMCPAgentTransport struct {
    AxMCPTransport
    schema Value
    started,release chan struct{}
    calls atomic.Int32
}
func(t *nativeMCPAgentTransport) SetMessageHandler(func(map[string]Value)){}
func(t *nativeMCPAgentTransport) SetLifecycleHandler(func(string)){}
func(t *nativeMCPAgentTransport) SendWithHeaders(message map[string]Value,_ map[string]string)(map[string]Value,error){
    var result Value
    switch message["method"] {
    case "server/discover":result=Object("resultType","complete","supportedVersions",Array("2026-07-28"),"ttlMs",60000,"cacheScope","private","capabilities",Object("tools",Object()))
    case "tools/list":result=Object("tools",Array(Object("name","lookup","description","Find reference","inputSchema",t.schema)))
    case "tools/call":
        params:=coreGet(message,"params",nil)
        if coreGet(params,"name",nil)!="lookup"||stableStringify(coreGet(params,"arguments",nil))!=`{"query":"REF-42"}`||coreGet(params,"_meta",nil)==nil{return nil,fmt.Errorf("Lost MCP invocation: %v",message)}
        t.calls.Add(1);close(t.started);select{case <-t.release:case <-time.After(3*time.Second):return nil,fmt.Errorf("MCP tool did not overlap model")}
        result=Object("resultType","complete","structuredContent",Object("reference","REF-42"),"content",Array(Object("type","text","text","REF-42")))
    default:return nil,fmt.Errorf("Unexpected MCP method: %v",message["method"])
    }
    return Object("jsonrpc","2.0","id",message["id"],"result",result),nil
}
type mcpAgentModelTransport struct {mcp *nativeMCPAgentTransport;hidden bool;requests int}
func(t *mcpAgentModelTransport) response(request Value)(Value,io.ReadCloser,error){
    t.requests++;number:=t.requests;body:=coreGet(request,"json",nil);actor:=[]Value{}
    for _,tool:=range asSlice(coreGet(body,"tools",Array())){if coreTruthy(coreGet(tool,"async",false)){actor=append(actor,tool)}}
    if t.hidden {
        if len(actor)!=0{return nil,nil,fmt.Errorf("Undiscovered MCP tool exposed")};text:=`{"completion":{"type":"final","args":["No discovered tools",{}]}}`;if number==3{text=`{"answer":"not discovered"}`};return sessionCompleted(fmt.Sprint("hidden-",number),text),nil,nil
    }
    if number==1||number==5 {
        if len(actor)!=0{return nil,nil,fmt.Errorf("Native authority escaped executor")};text:=`{"completion":{"type":"final","args":["Find reference",{}]}}`;if number==5{if !strings.Contains(stableStringify(body),"REF-42"){return nil,nil,fmt.Errorf("Responder preceded result incorporation")};text=`{"answer":"REF-42"}`};return sessionCompleted(fmt.Sprint("stage-",number),text),nil,nil
    }
    if number==2 {
        if len(actor)!=1||coreGet(actor[0],"name",nil)!="orders_lookup"||stableStringify(coreGet(actor[0],"parameters",nil))!=stableStringify(t.mcp.schema){return nil,nil,fmt.Errorf("Lost native MCP schema: %v",actor)}
        return Object("type","response.completed","response",Object("id","invalid-response","model","gpt-6-astra","output",Array(Object("type","function_call","id","invalid","call_id","invalid-call","name","orders_lookup","arguments",`{"query":"X"}`)))),nil,nil
    }
    if number==3 {
        if t.mcp.calls.Load()!=0||coreGet(body,"previous_response_id",nil)!="invalid-response"{return nil,nil,fmt.Errorf("Invalid arguments invoked MCP or lost correction")}
        reader,writer:=io.Pipe();go func(){defer writer.Close();sessionSSE(writer,Object("type","response.output_item.done","item",Object("type","function_call","id","valid","call_id","mcp-call","name","orders_lookup","arguments",`{"query":"REF-42"}`)));select{case <-t.mcp.started:case <-time.After(3*time.Second):_ = writer.CloseWithError(fmt.Errorf("MCP tool did not start"));return};close(t.mcp.release);sessionSSE(writer,sessionCompleted("tool-response",`{"completion":{"type":"final","args":["Report",{"answer":"provisional"}]}}`))}();return nil,reader,nil
    }
    if number!=4||coreGet(body,"previous_response_id",nil)!="tool-response"{return nil,nil,fmt.Errorf("Unexpected native continuation: %v",body)}
    input:=asSlice(coreGet(body,"input",Array()));result:=input[len(input)-1];if coreGet(result,"call_id",nil)!="mcp-call"||!strings.Contains(display(coreGet(result,"output",nil)),"REF-42"){return nil,nil,fmt.Errorf("Lost MCP result: %v",result)}
    return sessionCompleted("final-response",`{"completion":{"type":"final","args":["Report",{"answer":"REF-42"}]}}`),nil,nil
}
func(t *mcpAgentModelTransport) Call(_ context.Context,request Value)(Value,error){event,reader,err:=t.response(request);if reader!=nil{reader.Close();return nil,fmt.Errorf("Expected incremental transport")};if err!=nil{return nil,err};return coreGet(event,"response",nil),nil}
func(t *mcpAgentModelTransport) Stream(_ context.Context,request Value)(AxHTTPStreamResponse,error){event,reader,err:=t.response(request);if err!=nil{return AxHTTPStreamResponse{},err};if reader==nil{var text strings.Builder;sessionSSE(&text,event);reader=io.NopCloser(strings.NewReader(text.String()))};return AxHTTPStreamResponse{Status:200,Body:reader},nil}
func TestNativeMCPAgentDiscoveryAndInvocation(t *testing.T){
    schema:=parseJSON(`{"type":"object","$defs":{"reference":{"type":"string","minLength":3}},"properties":{"query":{"$ref":"#/$defs/reference"}},"required":["query"],"additionalProperties":false}`)
    transport:=&nativeMCPAgentTransport{AxMCPTransport:NewAxMCPScriptedTransport(nil),schema:schema,started:make(chan struct{}),release:make(chan struct{})}
    var allowed atomic.Bool;var authorizations atomic.Int32;var mcp *AxMCPClient
    authorize:=func(call map[string]Value)(bool,error){if call["client"]!=mcp||call["namespace"]!="orders"||coreGet(coreGet(call,"arguments",nil),"query",nil)!="REF-42"||stableStringify(coreGet(coreGet(call,"tool",nil),"inputSchema",nil))!=stableStringify(schema){return false,fmt.Errorf("Lost MCP authorization context")};authorizations.Add(1);return allowed.Load(),nil}
    mcp=NewAxMCPClient(transport,Object("era","modern","namespace","orders","authorizeToolCall",authorize));if err:=mcp.Init();err!=nil{t.Fatal(err)};native:=mcp.NativeTools()[0];if native.ExecutionMode=="background"{t.Fatal("MCP hints enabled background work")};native=native.Execution("background")
    if _,err:=native.Handler(Object("query","REF-42"));err==nil||!strings.Contains(err.Error(),"MCP tool call denied by host policy: lookup"){t.Fatalf("Denied MCP tool executed: %v",err)};if transport.calls.Load()!=0{t.Fatal("Denied MCP request reached transport")};allowed.Store(true)
    program:=NewAgent("question -> answer",Object("functions",Array(Object("namespace","orders","functions",Array(native))),"functionDiscovery",true,"directResponse","off"))
    model:=&mcpAgentModelTransport{mcp:transport,hidden:true};client:=NewAI("openai",Object("api_key","test","model","gpt-6-astra","transport",model))
    output,err:=program.Forward(context.Background(),client,Object("question","Find reference"),nil);if err!=nil||coreGet(output,"answer",nil)!="not discovered"||transport.calls.Load()!=0||model.requests!=3{t.Fatalf("Discovery boundary failed: %v %v",output,err)}
    program.Discover(Object("tools",Array("orders")));model.hidden=false;model.requests=0
    output,err=program.Forward(context.Background(),client,Object("question","Find reference"),nil);if err!=nil||coreGet(output,"answer",nil)!="REF-42"||transport.calls.Load()!=1||model.requests!=5{t.Fatalf("Native MCP invocation failed: %v %v",output,err)}
    recorded:=false;for _,entry:=range asSlice(coreGet(program.State,"action_log",Array())){if coreGet(entry,"qualified_name",nil)=="orders.lookup"&&coreGet(entry,"call_id",nil)=="mcp-call"&&coreGet(entry,"status",nil)=="ok"{recorded=true}};if !recorded{t.Fatal("Native MCP activity missing")}
    duplicate:=program.InvokeCallable("orders.lookup",Object("query","REF-42"),nil);if coreGet(duplicate,"status",nil)!="error"||transport.calls.Load()!=1{t.Fatal("Native MCP call replayed through actor code")}
    if authorizations.Load()!=2{t.Fatal("Invalid arguments or actor replay reached authorization")}
}

type childControlRuntime struct{ delegated bool; closed int; callbacks map[string]func(Value)(Value,error) }
func(r *childControlRuntime)RegisterHostCallable(name string, callback func(Value)(Value,error)){if r.callbacks==nil{r.callbacks=map[string]func(Value)(Value,error){}};r.callbacks[name]=callback}
func(r *childControlRuntime)Language()string{return "JavaScript"}
func(r *childControlRuntime)UsageInstructions()string{return ""}
func(r *childControlRuntime)CreateSession(map[string]Value,map[string]Value)(CodeSession,error){return &childControlSession{r},nil}
type childControlSession struct{runtime *childControlRuntime}
func(s *childControlSession)Execute(code string,_ map[string]Value)Value{if code=="delegate"{s.runtime.delegated=true;return Object("callable",Object("qualified_name","team.researcher","args",Object("question","Find reference"),"call_id","child-call"))};return Object("type","final","args",Array("Find reference",Object()))}
func(s *childControlSession)Inspect(map[string]Value)Value{return Object()}
func(s *childControlSession)SnapshotGlobals(map[string]Value)Value{return Object("globals",Object())}
func(s *childControlSession)PatchGlobals(v Value,_ map[string]Value)Value{return v}
func(s *childControlSession)Close()Value{s.runtime.closed++;return Object("closed",true)}
func TestOwnedChildControlsAndCancellation(t *testing.T){
 stages:=[]string{"root/distiller","root/executor","root/team.researcher/distiller","root/team.researcher/executor","root/team.researcher/responder","root/executor","root/responder"}
 for _,cancel:=range []bool{false,true}{
  control:=RunControl();observed:=[]map[string]Value{};requests:=[]Value{};var requestMu sync.Mutex;runtime:=&childControlRuntime{}
  control.OnEvent(func(event map[string]Value){observed=append(observed,event);if cancel&&event["type"]=="started"&&event["path"]=="root/team.researcher/executor"{control.Abort()}})
  if err:=control.Steer("ROOT-UPDATE");err!=nil{t.Fatal(err)};if err:=control.Steer("CHILD-ONLY","root/team.researcher");err!=nil{t.Fatal(err)};if err:=control.SetThinkingTokenBudget("medium","root/team.researcher/executor");err!=nil{t.Fatal(err)}
  transport:=&sessionTestTransport{}
  transport.stream=func(ctx context.Context,request Value,n int)(AxHTTPStreamResponse,error){
   requestMu.Lock();defer requestMu.Unlock();number:=n-1;body:=coreGet(request,"json",Object());stage:=stages[number/2];requests=append(requests,body)
   if number%2==1{
    raw,_:=json.Marshal(coreGet(body,"input",Array()));input:=string(raw)
    if coreGet(body,"previous_response_id",nil)!=fmt.Sprintf("child-r%d",number)||!strings.Contains(input,"ROOT-UPDATE")||strings.Contains(input,"CHILD-ONLY")!=strings.HasPrefix(stage,"root/team.researcher"){return AxHTTPStreamResponse{},fmt.Errorf("child controls lost: %s",input)}
    updates:=[]Value{};for _,item:=range asSlice(coreGet(body,"input",Array())){if coreGet(item,"type",nil)=="configuration_update"{updates=append(updates,item)}}
    if (len(updates)>0)!=(stage=="root/team.researcher/executor"){return AxHTTPStreamResponse{},fmt.Errorf("reasoning scope lost")}
    if len(updates)>0&&coreGet(coreGet(updates[0],"reasoning",nil),"effort",nil)!="medium"{return AxHTTPStreamResponse{},fmt.Errorf("reasoning value lost")}
    before,_:=json.Marshal(coreGet(requests[number-1],"reasoning",nil));after,_:=json.Marshal(coreGet(body,"reasoning",nil));if string(before)!=string(after){return AxHTTPStreamResponse{},fmt.Errorf("cache prefix changed")}
   }else if coreGet(body,"previous_response_id",nil)!=nil{return AxHTTPStreamResponse{},fmt.Errorf("child inherited conversation")}
   if number==10{raw,_:=json.Marshal(body);if !strings.Contains(string(raw),"REF-42"){return AxHTTPStreamResponse{},fmt.Errorf("parent continued without child result")}}
   var output Value
   if strings.HasPrefix(stage,"root/team.researcher"){if strings.HasSuffix(stage,"/responder"){output=Object("answer","REF-42")}else{output=Object("completion",Object("type","final","args",Array("Find reference",Object())))}}else if stage=="root/responder"{output=Object("answer","REF-42")}else{code:="parent-final";if stage=="root/executor"&&!runtime.delegated{code="delegate"};output=Object("javascriptCode",code)}
   raw,_:=json.Marshal(output);var data strings.Builder;sessionSSE(&data,sessionCompleted(fmt.Sprintf("child-r%d",n),string(raw)))
   return AxHTTPStreamResponse{Status:200,Body:io.NopCloser(strings.NewReader(data.String()))},nil
  }
  child:=NewAgent("question -> answer",Object("directResponse","off"));parent:=NewAgent("question -> answer",Object("directResponse","off","runtime",runtime)).AddChildAgent("team","researcher",child)
  client:=NewAI("openai",Object("model","gpt-6-astra","api_key","test","transport",transport))
  result,err:=parent.Forward(context.Background(),client,Object("question","Find reference"),Object("control",control))
  requestMu.Lock();requestCount:=len(requests);requestMu.Unlock()
  if cancel{if err==nil||!strings.Contains(strings.ToLower(err.Error()),"abort")||(requestCount<6||requestCount>7)||runtime.closed!=1{t.Fatalf("child cancellation cleanup: %v requests=%d closed=%d",err,requestCount,runtime.closed)}}else{
   if err!=nil||coreGet(result,"answer",nil)!="REF-42"||requestCount!=14{t.Fatalf("child completion: %v %v requests=%d",result,err,requestCount)}
   applied:=0;for _,event:=range observed{if event["type"]=="applied"{applied++}};if applied!=11{t.Fatalf("lost/duplicate controls: %v",observed)}
   usage,_:=json.Marshal(coreGet(coreGet(parent.GetUsage(),"children",nil),"team.researcher",nil));expected,_:=json.Marshal(child.GetUsage());if string(usage)!=string(expected){t.Fatalf("child usage: %s expected %s",usage,expected)}
  }
  count:=0;for _,item:=range asSlice(parent.GetActionLog()){if coreGet(item,"call_id",nil)=="child-call"{count++;expected:="ok";if cancel{expected="error"};if coreGet(item,"status",nil)!=expected{t.Fatalf("child status: %v",item)}}};if count!=1{t.Fatalf("child call count %d",count)}
  childUsage,_:=json.Marshal(coreGet(coreGet(parent.GetUsage(),"children",nil),"team.researcher",nil));actualChildUsage,_:=json.Marshal(child.GetUsage());if string(childUsage)!=string(actualChildUsage){t.Fatalf("Child failure usage lost: parent=%s child=%s",childUsage,actualChildUsage)}
  for _,name:=range []string{"team.researcher","llmQuery"}{if _,lateErr:=runtime.callbacks[name](Object("question","Late request"));lateErr==nil||!strings.Contains(lateErr.Error(),"closed run"){t.Fatalf("late callback %s: %v",name,lateErr)}}
  if coreTruthy(parent.State["forward_active"])||parent.State["active_client"]!=nil||coreTruthy(child.State["forward_active"])||child.State["active_client"]!=nil{t.Fatal("active client retained")}
 }
}
