package axllm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	if n == 2 {
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
	if n != 3 || coreGet(body, "previous_response_id", "") != "executor1" || !strings.Contains(stableStringify(coreGet(body, "input", nil)), "REF-42") {
		return AxHTTPStreamResponse{}, fmt.Errorf("lost native result: %v", body)
	}
	var out strings.Builder
	sessionSSE(&out, sessionCompleted("executor2", "{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"))
	return AxHTTPStreamResponse{Status: 200, Body: io.NopCloser(strings.NewReader(out.String()))}, nil
}
func TestAstraAgentNativeToolsAndActionLog(t *testing.T) {
	transport := &agentSessionTransport{started: make(chan struct{}), release: make(chan struct{})}
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
	result, err := program.Forward(ctx, client, Object("question", "Find reference"), Object())
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
 for _, exhausted := range []bool{false,true} { t.Run(fmt.Sprint(exhausted),func(t *testing.T){
  var calls atomic.Int32
  transport:=&sessionTestTransport{}
  transport.stream=func(ctx context.Context,request Value,n int)(AxHTTPStreamResponse,error){
   if coreGet(coreGet(request,"json",Object()),"temperature",nil)!=nil{return AxHTTPStreamResponse{},fmt.Errorf("Astra leaked temperature: %v",coreGet(request,"json",Object()))}
   var event Value
   if n==1 {event=Object("type","response.completed","response",Object("id","invalid","model","gpt-6-astra","output",Array(Object("type","function_call","id","invalid-item","call_id","invalid-call","name","validated_lookup","arguments","{}"))))
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
  program:=NewAx("question -> answer",nil);program.Functions=[]Tool{tool}
  steps:=3;if exhausted{steps=1}
  result,err:=program.Forward(context.Background(),client,Object("question","Find reference"),Object("maxSteps",steps))
  if exhausted {if err==nil||!strings.Contains(err.Error(),"steps"){t.Fatalf("expected exhaustion, got %v %v",result,err)}}else if err!=nil||coreGet(result,"answer",nil)!="CORRECTED"{t.Fatalf("correction failed: %v %v",result,err)}
  expected:=2;if exhausted{expected=1};if calls.Load()!=0||len(transport.requests)!=expected{t.Fatalf("invalid execution or replay: %d %d",calls.Load(),len(transport.requests))}
 })}
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
