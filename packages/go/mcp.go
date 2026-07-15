package axllm

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

const AX_MCP_PROTOCOL_VERSION = "2025-11-25"

var AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = []string{
	AX_MCP_PROTOCOL_VERSION,
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
}

type AxMCPTokenSet struct {
	AccessToken string
	RefreshToken string
	ExpiresAt int64
	Issuer string
}

type AxMCPOAuthOptions struct {
	ClientID string
	ClientSecret string
	RedirectURI string
	Scopes []string
	OnAuthCode func(string) (map[string]string, error)
	TokenStore AxMCPTokenStore
	SSRFProtection map[string]Value
}

type AxMCPTokenStore interface {
	GetToken(key string) (*AxMCPTokenSet, error)
	SetToken(key string, token AxMCPTokenSet) error
	ClearToken(key string) error
}

type AxMCPTransport interface {
	Send(message map[string]Value) (map[string]Value, error)
	SendNotification(message map[string]Value) error
	SendResponse(message map[string]Value) error
	SetMessageHandler(handler func(map[string]Value))
	SetLifecycleHandler(handler func(string))
	SetProtocolVersion(protocolVersion string)
	Connect() error
	StartListening() error
	Close() error
}

type AxMCPClient struct {
	transport AxMCPTransport
	options map[string]Value
	serverCapabilities map[string]Value
	serverInfo map[string]Value
	serverInstructions string
	negotiatedProtocolVersion string
	tools []map[string]Value
	prompts []map[string]Value
	resources []map[string]Value
	resourceTemplates []map[string]Value
	catalogRevision int64
	subscriptionOwners map[string]map[string]bool
	nextID int
	notificationListeners map[int]func(map[string]Value)
	lifecycleListeners map[int]func(string)
	nextListenerID int
	initialized bool
}

func NewAxMCPClient(transport AxMCPTransport, options map[string]Value) *AxMCPClient {
	if options == nil { options = map[string]Value{} }
	c := &AxMCPClient{transport: transport, options: options, nextID: 1, notificationListeners:map[int]func(map[string]Value){}, lifecycleListeners:map[int]func(string){}, nextListenerID:1,subscriptionOwners:map[string]map[string]bool{}}
	transport.SetMessageHandler(c.handleInboundMessage)
	transport.SetLifecycleHandler(c.EmitLifecycle)
	return c
}

func (c *AxMCPClient) Init() error {
	if c.initialized { return nil }
	if err := c.transport.Connect(); err != nil { return err }
	protocol := display(coreGet(c.options, "protocolVersion", AX_MCP_PROTOCOL_VERSION))
	params := map[string]Value{
		"protocolVersion": protocol,
		"capabilities": c.clientCapabilities(),
		"clientInfo": map[string]Value{"name":"AxMCPClient", "title":"Ax MCP Client", "version":"1.0.0"},
	}
	for key, value := range asMap(coreGet(c.options, "clientInfo", Object())) {
		asMap(params["clientInfo"])[key] = value
	}
	result, err := c.request("initialize", params)
	if err != nil { return err }
	negotiated := display(coreGet(result, "protocolVersion", ""))
	supported := stringList(coreGet(c.options, "supportedProtocolVersions", AX_MCP_SUPPORTED_PROTOCOL_VERSIONS))
	if !stringIn(supported, negotiated) { return AxError{Category:"mcp", Message:"Unsupported MCP protocol version "+negotiated} }
	c.negotiatedProtocolVersion = negotiated
	c.transport.SetProtocolVersion(negotiated)
	c.serverCapabilities = asMap(coreGet(result, "capabilities", Object()))
	c.serverInfo = asMap(coreGet(result, "serverInfo", Object()))
	c.serverInstructions = display(coreGet(result, "instructions", ""))
	_ = c.Notify("notifications/initialized", nil)
	if err := c.Refresh(); err != nil { return err }
	c.initialized = true
	return c.transport.StartListening()
}

func (c *AxMCPClient) Close() error { c.initialized = false;c.subscriptionOwners=map[string]map[string]bool{}; return c.transport.Close() }

func (c *AxMCPClient) Refresh() error {
	c.tools = nil; c.prompts = nil; c.resources = nil; c.resourceTemplates = nil
	if c.capability("tools") {
		values,err:=c.collectCatalog("tools/list","tools");if err!=nil{return err};c.tools=values
	}
	if c.capability("prompts") {
		values,err:=c.collectCatalog("prompts/list","prompts");if err!=nil{return err};c.prompts=values
	}
	if c.capability("resources") {
		values,err:=c.collectCatalog("resources/list","resources");if err!=nil{return err};c.resources=values
		templates,err:=c.collectCatalog("resources/templates/list","resourceTemplates");if err!=nil{return err};c.resourceTemplates=templates
	}
	c.catalogRevision++
	return nil
}

func (c *AxMCPClient) collectCatalog(method,field string)([]map[string]Value,error){out:=[]map[string]Value{};cursor:="";seen:=map[string]bool{};maxPages:=1000;if value,ok:=c.options["maxPaginationPages"].(int);ok{maxPages=value};for page:=0;page<maxPages;page++{result,err:=c.request(method,cursorParams(cursor));if err!=nil{return nil,err};for _,item:=range asSlice(coreGet(result,field,Array())){out=append(out,cloneMCPMap(asMap(item)))};cursor=display(coreGet(result,"nextCursor",""));if cursor==""{return out,nil};if seen[cursor]{return nil,fmt.Errorf("MCP %s repeated pagination cursor %s",method,cursor)};seen[cursor]=true};return nil,fmt.Errorf("MCP %s exceeded %d pagination pages",method,maxPages)}

type AxMCPCatalogSnapshot struct{Namespace,ProtocolVersion string;Revision int64;ServerInfo,ServerCapabilities map[string]Value;Tools,Prompts,Resources,ResourceTemplates []map[string]Value;Subscriptions []string}
func (c *AxMCPClient) InspectCatalog(refresh bool)(AxMCPCatalogSnapshot,error){if err:=c.Init();err!=nil{return AxMCPCatalogSnapshot{},err};if refresh{if err:=c.Refresh();err!=nil{return AxMCPCatalogSnapshot{},err}};subscriptions:=[]string{};for uri:=range c.subscriptionOwners{subscriptions=append(subscriptions,uri)};sort.Strings(subscriptions);cloneList:=func(values []map[string]Value)[]map[string]Value{out:=make([]map[string]Value,0,len(values));for _,value:=range values{out=append(out,cloneMCPMap(value))};return out};return AxMCPCatalogSnapshot{c.Namespace(),c.negotiatedProtocolVersion,c.catalogRevision,cloneMCPMap(c.serverInfo),cloneMCPMap(c.serverCapabilities),cloneList(c.tools),cloneList(c.prompts),cloneList(c.resources),cloneList(c.resourceTemplates),subscriptions},nil}

func (c *AxMCPClient) ProtocolVersion() string { return c.negotiatedProtocolVersion }
func (c *AxMCPClient) Tools() []map[string]Value { return append([]map[string]Value(nil), c.tools...) }
func (c *AxMCPClient) Prompts() []map[string]Value { return append([]map[string]Value(nil), c.prompts...) }
func (c *AxMCPClient) Resources() []map[string]Value { return append([]map[string]Value(nil), c.resources...) }
func (c *AxMCPClient) ResourceTemplates() []map[string]Value { return append([]map[string]Value(nil), c.resourceTemplates...) }
func (c *AxMCPClient) Ping() (map[string]Value, error) { return c.request("ping", map[string]Value{}) }
func (c *AxMCPClient) ListTools(cursor string) (map[string]Value, error) { return c.request("tools/list", cursorParams(cursor)) }
func (c *AxMCPClient) CallTool(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("tools/call", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListPrompts(cursor string) (map[string]Value, error) { return c.request("prompts/list", cursorParams(cursor)) }
func (c *AxMCPClient) GetPrompt(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("prompts/get", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListResources(cursor string) (map[string]Value, error) { return c.request("resources/list", cursorParams(cursor)) }
func (c *AxMCPClient) ReadResource(uri string) (map[string]Value, error) { return c.request("resources/read", map[string]Value{"uri":uri}) }
func (c *AxMCPClient) assertResourceSubscriptions()error{capability:=asMap(coreGet(c.serverCapabilities,"resources",Object()));if !coreTruthy(capability["subscribe"]){return fmt.Errorf("resource subscriptions are not supported")};return nil}
func (c *AxMCPClient) AcquireResourceSubscription(uri,owner string)(map[string]Value,error){if err:=c.assertResourceSubscriptions();err!=nil{return nil,err};current:=[]string{};for value:=range c.subscriptionOwners[uri]{current=append(current,value)};sort.Strings(current);raw,err:=mcp_resource_subscription_ownership(current,owner,"acquire");if err!=nil{return nil,err};transition:=asMap(raw);result:=map[string]Value{};if display(transition["wireAction"])=="subscribe"{result,err=c.request("resources/subscribe",map[string]Value{"uri":uri});if err!=nil{return nil,err}};owners:=map[string]bool{};for _,value:=range asSlice(transition["owners"]){owners[display(value)]=true};c.subscriptionOwners[uri]=owners;return result,nil}
func (c *AxMCPClient) ReleaseResourceSubscription(uri,owner string)(map[string]Value,error){if err:=c.assertResourceSubscriptions();err!=nil{return nil,err};current:=[]string{};for value:=range c.subscriptionOwners[uri]{current=append(current,value)};sort.Strings(current);raw,err:=mcp_resource_subscription_ownership(current,owner,"release");if err!=nil{return nil,err};transition:=asMap(raw);result:=map[string]Value{};if display(transition["wireAction"])=="unsubscribe"{result,err=c.request("resources/unsubscribe",map[string]Value{"uri":uri});if err!=nil{return nil,err}};owners:=map[string]bool{};for _,value:=range asSlice(transition["owners"]){owners[display(value)]=true};if len(owners)==0{delete(c.subscriptionOwners,uri)}else{c.subscriptionOwners[uri]=owners};return result,nil}
func (c *AxMCPClient) RestoreResourceSubscriptions()error{uris:=[]string{};for uri:=range c.subscriptionOwners{uris=append(uris,uri)};sort.Strings(uris);for _,uri:=range uris{if _,err:=c.request("resources/subscribe",map[string]Value{"uri":uri});err!=nil{return err}};return nil}
func (c *AxMCPClient) SubscribeResource(uri string)(map[string]Value,error){return c.AcquireResourceSubscription(uri,"manual")}
func (c *AxMCPClient) UnsubscribeResource(uri string)(map[string]Value,error){return c.ReleaseResourceSubscription(uri,"manual")}
func (c *AxMCPClient) GetTask(taskID string)(map[string]Value,error){return c.request("tasks/get",map[string]Value{"taskId":taskID})}
func (c *AxMCPClient) CancelTask(taskID string)(map[string]Value,error){return c.request("tasks/cancel",map[string]Value{"taskId":taskID})}
func (c *AxMCPClient) ListResourceTemplates(cursor string) (map[string]Value, error) { return c.request("resources/templates/list", cursorParams(cursor)) }

func (c *AxMCPClient) Notify(method string, params map[string]Value) error {
	msg := map[string]Value{"jsonrpc":"2.0", "method":method}
	if params != nil { msg["params"] = params }
	return c.transport.SendNotification(msg)
}

func (c *AxMCPClient) CancelRequest(requestID Value, reason string) error {
	params := map[string]Value{"requestId":requestID}
	if reason != "" { params["reason"] = reason }
	return c.Notify("notifications/cancelled", params)
}
func (c *AxMCPClient) AddNotificationListener(listener func(map[string]Value))func(){id:=c.nextListenerID;c.nextListenerID++;c.notificationListeners[id]=listener;return func(){delete(c.notificationListeners,id)}}
func (c *AxMCPClient) AddLifecycleListener(listener func(string))func(){id:=c.nextListenerID;c.nextListenerID++;c.lifecycleListeners[id]=listener;return func(){delete(c.lifecycleListeners,id)}}
func (c *AxMCPClient) EmitLifecycle(state string){if state=="reconnected"{_ = c.RestoreResourceSubscriptions()};listeners:=make([]func(string),0,len(c.lifecycleListeners));for _,listener:=range c.lifecycleListeners{listeners=append(listeners,listener)};for _,listener:=range listeners{listener(state)}}

func (c *AxMCPClient) ToFunction() []Tool {
	var out []Tool
	for _, tool := range c.tools { out = append(out, c.toolToFunction(tool)) }
	for _, prompt := range c.prompts { out = append(out, c.promptToFunction(prompt)) }
	for _, resource := range c.resources { out = append(out, c.resourceToFunction(resource)) }
	for _, templ := range c.resourceTemplates { out = append(out, c.resourceTemplateToFunction(templ)) }
	return out
}

func (c *AxMCPClient) NativeTools() []Tool {
	out := []Tool{}
	for _, spec := range c.tools {
		original := display(coreGet(spec, "name", ""))
		name := c.overrideName(original)
		desc := c.overrideDescription(spec)
		out = append(out, Tool{Name:name, Description:desc, Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) {
			return c.CallTool(original, args)
		}})
	}
	return out
}

func (c *AxMCPClient) Namespace() string {
	if value := display(coreGet(c.options, "namespace", "")); value != "" { return value }
	if value := display(coreGet(c.serverInfo, "name", "")); value != "" { return value }
	return "mcp"
}

func (c *AxMCPClient) Request(method string, params map[string]Value) (map[string]Value, error) {
	return c.request(method, params)
}

type AxUCPBinding interface {
	Call(operation string, payload map[string]Value, options map[string]Value) (map[string]Value, error)
}

type AxUCPBindingFunc func(operation string, payload map[string]Value, options map[string]Value) (map[string]Value, error)
func (fn AxUCPBindingFunc) Call(operation string, payload map[string]Value, options map[string]Value) (map[string]Value, error) { return fn(operation, payload, options) }

var AxUCPOperations = []string{
	"catalog.search", "catalog.lookup", "catalog.product",
	"cart.create", "cart.get", "cart.update", "cart.cancel",
	"checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel",
	"fulfillment.quote", "discounts.apply", "payments.create", "payments.confirm",
	"orders.get", "identity.link", "attribution.record", "handoff.create",
}

type AxUCPClient struct {
	Profile map[string]Value
	Binding AxUCPBinding
	Options map[string]Value
	Version string
}

func NewAxUCPClient(profile map[string]Value, binding AxUCPBinding, options map[string]Value) (*AxUCPClient, error) {
	if profile == nil { profile = map[string]Value{} }
	if options == nil { options = map[string]Value{} }
	version := display(coreGet(profile, "version", coreGet(options, "version", "2026-04-08")))
	supported := stringList(coreGet(options, "supportedVersions", []string{"2026-04-08"}))
	if !stringIn(supported, version) { return nil, fmt.Errorf("Unsupported UCP version %s", version) }
	return &AxUCPClient{Profile:profile, Binding:binding, Options:options, Version:version}, nil
}

func (c *AxUCPClient) Namespace() string {
	if value := display(coreGet(c.Options, "namespace", "")); value != "" { return value }
	if value := display(coreGet(c.Profile, "name", "")); value != "" { return value }
	return "ucp"
}

func (c *AxUCPClient) Call(operation string, payload map[string]Value, idempotencyKey string) (map[string]Value, error) {
	if !stringIn(AxUCPOperations, operation) { return nil, fmt.Errorf("Unsupported UCP operation %s", operation) }
	if payload == nil { payload = map[string]Value{} }
	if idempotencyKey == "" { idempotencyKey = fmt.Sprintf("ax-ucp-%d", time.Now().UnixNano()) }
	value, err := c.Binding.Call(operation, payload, map[string]Value{"version":c.Version, "idempotencyKey":idempotencyKey})
	if err != nil { return nil, err }
	return map[string]Value{
		"operation":operation, "value":value, "warnings":coreGet(value, "warnings", nil),
		"partialSuccess": coreGet(value, "partial_success", coreGet(value, "partialSuccess", false)),
		"continuationUrl": coreGet(value, "continuation_url", coreGet(value, "continuationUrl", nil)),
		"idempotencyKey":idempotencyKey,
	}, nil
}

func (c *AxUCPClient) NativeTools() []Tool {
	out := []Tool{}
	for _, operation := range AxUCPOperations {
		op := operation
		out = append(out, Tool{Name:c.Namespace()+"_"+strings.ReplaceAll(op, ".", "_"), Description:"UCP "+op+" operation", Args:map[string]Field{}, Returns:map[string]Field{}, Handler:func(args map[string]Value) (Value,error) { return c.Call(op, args, "") }})
	}
	return out
}

func (c *AxUCPClient) CatalogSearch(payload map[string]Value) (map[string]Value,error) { return c.Call("catalog.search",payload,"") }
func (c *AxUCPClient) CatalogLookup(payload map[string]Value) (map[string]Value,error) { return c.Call("catalog.lookup",payload,"") }
func (c *AxUCPClient) CatalogProduct(payload map[string]Value) (map[string]Value,error) { return c.Call("catalog.product",payload,"") }
func (c *AxUCPClient) CartCreate(payload map[string]Value) (map[string]Value,error) { return c.Call("cart.create",payload,"") }
func (c *AxUCPClient) CartGet(payload map[string]Value) (map[string]Value,error) { return c.Call("cart.get",payload,"") }
func (c *AxUCPClient) CartUpdate(payload map[string]Value) (map[string]Value,error) { return c.Call("cart.update",payload,"") }
func (c *AxUCPClient) CartCancel(payload map[string]Value) (map[string]Value,error) { return c.Call("cart.cancel",payload,"") }
func (c *AxUCPClient) CheckoutCreate(payload map[string]Value) (map[string]Value,error) { return c.Call("checkout.create",payload,"") }
func (c *AxUCPClient) CheckoutGet(payload map[string]Value) (map[string]Value,error) { return c.Call("checkout.get",payload,"") }
func (c *AxUCPClient) CheckoutUpdate(payload map[string]Value) (map[string]Value,error) { return c.Call("checkout.update",payload,"") }
func (c *AxUCPClient) CheckoutComplete(payload map[string]Value) (map[string]Value,error) { return c.Call("checkout.complete",payload,"") }
func (c *AxUCPClient) CheckoutCancel(payload map[string]Value) (map[string]Value,error) { return c.Call("checkout.cancel",payload,"") }
func (c *AxUCPClient) OrderGet(payload map[string]Value) (map[string]Value,error) { return c.Call("orders.get",payload,"") }
func (c *AxUCPClient) IdentityLink(payload map[string]Value) (map[string]Value,error) { return c.Call("identity.link",payload,"") }

type AxMCPContinuationState struct {
	Namespaces []string `json:"namespaces"`
	Tasks []map[string]Value `json:"tasks"`
	Subscriptions []map[string]Value `json:"subscriptions"`
	CatalogFingerprint string `json:"catalogFingerprint"`
}

type AxEventEnvelope struct {
	SpecVersion string `json:"specversion"`
	ID string `json:"id"`
	Source string `json:"source"`
	Type string `json:"type"`
	Subject string `json:"subject,omitempty"`
	Data Value `json:"data,omitempty"`
	Extensions map[string]Value `json:"extensions,omitempty"`
	Correlation []map[string]string `json:"correlation,omitempty"`
}

type AxEventPath struct { Root string; Segments []Value; CorrelationKind string; Value Value }
func (p AxEventPath) value() map[string]Value { out:=map[string]Value{"root":p.Root,"segments":p.Segments};if p.CorrelationKind!=""{out["correlationKind"]=p.CorrelationKind};if p.Root=="constant"{out["value"]=p.Value};return out }
func EventData(segments ...Value) AxEventPath{return AxEventPath{Root:"data",Segments:segments}}
func EventEnvelope(segments ...Value) AxEventPath{return AxEventPath{Root:"envelope",Segments:segments}}
func EventSubject() AxEventPath{return EventEnvelope("subject")}
func EventExtension(name string) AxEventPath{return AxEventPath{Root:"extensions",Segments:[]Value{name}}}
func EventIdentity(segments ...Value) AxEventPath{return AxEventPath{Root:"identity",Segments:segments}}
func EventTrust() AxEventPath{return AxEventPath{Root:"trust"}}
func EventCorrelation(kind string) AxEventPath{return AxEventPath{Root:"correlation",CorrelationKind:kind}}
func EventContinuation(segments ...Value) AxEventPath{return AxEventPath{Root:"continuation",Segments:segments}}
func EventConstant(value Value) AxEventPath{return AxEventPath{Root:"constant",Value:value}}
type AxEventInputField struct { Field string; Path AxEventPath }
type AxEventInputPlan struct { Project *AxEventPath; Fields []AxEventInputField }
func (p AxEventInputPlan) value()map[string]Value{fields:=[]Value{};for _,field:=range p.Fields{fields=append(fields,map[string]Value{"field":field.Field,"path":field.Path.value()})};out:=map[string]Value{"fields":fields};if p.Project!=nil{out["project"]=p.Project.value()};return out}
type AxEventInputBuilder struct{project *AxEventPath;fields []AxEventInputField}
func (b *AxEventInputBuilder) Project(path AxEventPath)*AxEventInputBuilder{if b.project!=nil{panic("An event input plan may project only one path")};b.project=&path;return b}
func (b *AxEventInputBuilder) Field(name string,path AxEventPath)*AxEventInputBuilder{for _,field:=range b.fields{if field.Field==name{panic("Event input field "+name+" is mapped more than once")}};b.fields=append(b.fields,AxEventInputField{name,path});return b}
func (b *AxEventInputBuilder) Build()AxEventInputPlan{return AxEventInputPlan{b.project,append([]AxEventInputField(nil),b.fields...)}}

func (e AxEventEnvelope) value() map[string]Value {
	out:=map[string]Value{"specversion":e.SpecVersion,"id":e.ID,"source":e.Source,"type":e.Type}
	if e.Subject!="" { out["subject"]=e.Subject }; if e.Data!=nil { out["data"]=e.Data }; if len(e.Extensions)>0{out["extensions"]=e.Extensions};if len(e.Correlation)>0{out["correlation"]=e.Correlation};return out
}

type AxEventRoute struct { ID string; Action string; Match map[string]Value; TargetID string; RequireAuthenticated bool; Ordering string; DebounceMs int64; InstanceKey *AxEventPath }
func (r AxEventRoute) value() map[string]Value { out:=map[string]Value{"id":r.ID,"action":r.Action,"match":r.Match,"targetId":r.TargetID,"requireAuthenticated":r.RequireAuthenticated,"ordering":r.Ordering,"debounceMs":r.DebounceMs};if r.InstanceKey!=nil{out["instanceKey"]=r.InstanceKey.value()};return out }
type AxEventCommand struct { RouteID string; Action string; TargetID string; InstanceKey string; IdempotencyKey string }
type AxEventPublishReceipt struct { EventID string; Accepted bool; Duplicate bool; Durability string; DeliveryIDs []string }
type AxEventRun struct { ID,DeliveryID,RouteID,TargetID,InstanceKey,Status string; Attempt int; Output Value; Error string; ContinuationIDs []string }
type AxEventDeadLetter struct { ID,DeliveryID,RunID,SinkID,Reason string }
type AxEventContinuation struct { ID,TargetID,InstanceKey,IdentityScope string; Correlation []map[string]string; Metadata map[string]Value; Completed bool; ExpiresAt int64 }
type AxEventCancellationToken struct { mu sync.Mutex; Cancelled bool; Reason string }
func (t *AxEventCancellationToken) Cancel(reason string){t.mu.Lock();defer t.mu.Unlock();t.Cancelled=true;t.Reason=reason}
func (t *AxEventCancellationToken) IsCancelled()bool{t.mu.Lock();defer t.mu.Unlock();return t.Cancelled}
type AxEventTarget struct {
	ID string
	Invoke func(Value,map[string]Value)(Value,error)
	MapInput func(AxEventEnvelope,*AxEventContinuation)(Value,error)
	Sinks map[string]AxEventSink
	RetrySafety string
	WaitFor []map[string]Value
	CaptureState func()(Value,error)
	RestoreState func(Value)error
	Signature *AxSignature
	Input *AxEventInputPlan
	WakeInput *AxEventInputPlan
	ResumeInput *AxEventInputPlan
}
type AxEventTargetBuilder struct{target AxEventTarget}
func EventTarget(id string)*AxEventTargetBuilder{return &AxEventTargetBuilder{target:AxEventTarget{ID:id,Sinks:map[string]AxEventSink{}}}}
func (b *AxEventTargetBuilder) Invoke(value func(Value,map[string]Value)(Value,error))*AxEventTargetBuilder{b.target.Invoke=value;return b}
func (b *AxEventTargetBuilder) Signature(value AxSignature)*AxEventTargetBuilder{b.target.Signature=&value;return b}
func (b *AxEventTargetBuilder) ProgramGen(program *AxGen,client AIClient)*AxEventTargetBuilder{b.target.Signature=&program.Signature;b.target.Invoke=func(value Value,_ map[string]Value)(Value,error){return program.Forward(context.Background(),client,asMap(value),nil)};return b}
func (b *AxEventTargetBuilder) ProgramAgent(program *AxAgent,client AIClient)*AxEventTargetBuilder{b.target.Signature=&program.Signature;b.target.Invoke=func(value Value,_ map[string]Value)(Value,error){return program.Forward(context.Background(),client,asMap(value),nil)};return b}
func (b *AxEventTargetBuilder) ProgramFlow(program *AxFlow,client AIClient,signature AxSignature)*AxEventTargetBuilder{b.target.Signature=&signature;b.target.Invoke=func(value Value,_ map[string]Value)(Value,error){return program.Forward(context.Background(),client,asMap(value),nil)};return b}
func (b *AxEventTargetBuilder) MapInput(value func(AxEventEnvelope,*AxEventContinuation)(Value,error))*AxEventTargetBuilder{b.target.MapInput=value;return b}
func eventInputPlan(mapping func(*AxEventInputBuilder))*AxEventInputPlan{builder:=&AxEventInputBuilder{};mapping(builder);value:=builder.Build();return &value}
func (b *AxEventTargetBuilder) Input(mapping func(*AxEventInputBuilder))*AxEventTargetBuilder{b.target.Input=eventInputPlan(mapping);return b}
func (b *AxEventTargetBuilder) WakeInput(mapping func(*AxEventInputBuilder))*AxEventTargetBuilder{b.target.WakeInput=eventInputPlan(mapping);return b}
func (b *AxEventTargetBuilder) ResumeInput(mapping func(*AxEventInputBuilder))*AxEventTargetBuilder{b.target.ResumeInput=eventInputPlan(mapping);return b}
func (b *AxEventTargetBuilder) Sink(id string,value AxEventSink)*AxEventTargetBuilder{b.target.Sinks[id]=value;return b}
func (b *AxEventTargetBuilder) RetrySafety(value string)*AxEventTargetBuilder{b.target.RetrySafety=value;return b}
func (b *AxEventTargetBuilder) WaitFor(kind string,path AxEventPath,metadata map[string]Value)*AxEventTargetBuilder{b.target.WaitFor=append(b.target.WaitFor,map[string]Value{"kind":kind,"value":path.value(),"metadata":metadata});return b}
func (b *AxEventTargetBuilder) Build()(AxEventTarget,error){if b.target.Invoke==nil{return AxEventTarget{},fmt.Errorf("event target requires an invoker or program")};if b.target.MapInput!=nil&&(b.target.Input!=nil||b.target.WakeInput!=nil||b.target.ResumeInput!=nil){return AxEventTarget{},fmt.Errorf("declarative mappings and MapInput are mutually exclusive")};if (b.target.Input!=nil||b.target.WakeInput!=nil||b.target.ResumeInput!=nil)&&b.target.Signature==nil{return AxEventTarget{},fmt.Errorf("declarative event mappings require a signature")};return b.target,nil}
type AxEventRouteBuilder struct{route AxEventRoute}
func EventRoute(id string)*AxEventRouteBuilder{return &AxEventRouteBuilder{route:AxEventRoute{ID:id,Match:map[string]Value{},Ordering:"strict"}}}
func (b *AxEventRouteBuilder) Types(values ...string)*AxEventRouteBuilder{items:=[]Value{};for _,value:=range values{items=append(items,value)};b.route.Match["types"]=items;return b}
func (b *AxEventRouteBuilder) Sources(values ...string)*AxEventRouteBuilder{items:=[]Value{};for _,value:=range values{items=append(items,value)};b.route.Match["sources"]=items;return b}
func (b *AxEventRouteBuilder) Authenticated()*AxEventRouteBuilder{b.route.RequireAuthenticated=true;return b}
func (b *AxEventRouteBuilder) InstanceKey(path AxEventPath)*AxEventRouteBuilder{b.route.InstanceKey=&path;return b}
func (b *AxEventRouteBuilder) Wake(target AxEventTarget)*AxEventRouteBuilder{b.route.Action="wake";b.route.TargetID=target.ID;return b}
func (b *AxEventRouteBuilder) Resume()*AxEventRouteBuilder{b.route.Action="resume";return b}
func (b *AxEventRouteBuilder) Observe()*AxEventRouteBuilder{b.route.Action="observe";return b}
func (b *AxEventRouteBuilder) Invalidate()*AxEventRouteBuilder{b.route.Action="invalidate";return b}
func (b *AxEventRouteBuilder) Build()(AxEventRoute,error){if b.route.Action==""{return AxEventRoute{},fmt.Errorf("event route requires one action")};return b.route,nil}
type AxEventSource interface { Start(func(AxEventEnvelope) error) error; Close() error }
type AxScopedEventSource interface { StartScoped(func(AxEventEnvelope,string,string) error) error }
type AxEventSink interface { Write(Value, map[string]Value) error }
type AxEventClock interface { Now() int64; Sleep(time.Duration,*AxEventCancellationToken) bool }
type AxSystemEventClock struct{}
func (AxSystemEventClock) Now()int64{return time.Now().UnixMilli()}
func (AxSystemEventClock) Sleep(delay time.Duration,token *AxEventCancellationToken)bool{timer:=time.NewTimer(delay);defer timer.Stop();<-timer.C;return token==nil||!token.IsCancelled()}
type AxManualEventClock struct{mu sync.Mutex;cond *sync.Cond;current int64}
func NewAxManualEventClock(current int64)*AxManualEventClock{value:=&AxManualEventClock{current:current};value.cond=sync.NewCond(&value.mu);return value}
func (c *AxManualEventClock) Now()int64{c.mu.Lock();defer c.mu.Unlock();return c.current}
func (c *AxManualEventClock) Advance(milliseconds int64){c.mu.Lock();c.current+=milliseconds;c.cond.Broadcast();c.mu.Unlock()}
func (c *AxManualEventClock) Sleep(delay time.Duration,token *AxEventCancellationToken)bool{target:=c.Now()+delay.Milliseconds();c.mu.Lock();defer c.mu.Unlock();for c.current<target{if token!=nil&&token.IsCancelled(){return false};c.cond.Wait()};return token==nil||!token.IsCancelled()}
type AxEventStore interface { Enqueue(AxEventEnvelope, []AxEventCommand) error }
type axEventDelivery struct { Event AxEventEnvelope; Command AxEventCommand; IdentityScope,Trust,Status,RunID string; AvailableAt,Sequence,Size int64; Attempt int }
type AxInMemoryEventStore struct { Deliveries map[string]*axEventDelivery; Runs map[string]*AxEventRun; DeadLetters map[string]AxEventDeadLetter; Continuations map[string]*AxEventContinuation; ProgramState map[string]Value; Clock AxEventClock;MaxPending int;MaxQueuedBytes,MaxEnvelopeBytes,PublishTimeoutMs,QueuedBytes,sequence int64;mu sync.Mutex;cond *sync.Cond }
func NewAxInMemoryEventStore()*AxInMemoryEventStore{return NewAxInMemoryEventStoreWithClock(AxSystemEventClock{},nil)}
func NewAxInMemoryEventStoreWithClock(clock AxEventClock,options map[string]Value)*AxInMemoryEventStore{value:=&AxInMemoryEventStore{Deliveries:map[string]*axEventDelivery{},Runs:map[string]*AxEventRun{},DeadLetters:map[string]AxEventDeadLetter{},Continuations:map[string]*AxEventContinuation{},ProgramState:map[string]Value{},Clock:clock,MaxPending:10_000,MaxQueuedBytes:64*1024*1024,MaxEnvelopeBytes:1024*1024,PublishTimeoutMs:5_000};if options!=nil{if n,ok:=options["maxPending"].(int);ok{value.MaxPending=n};if n,ok:=options["maxQueuedBytes"].(int64);ok{value.MaxQueuedBytes=n};if n,ok:=options["maxEnvelopeBytes"].(int64);ok{value.MaxEnvelopeBytes=n};if n,ok:=options["publishTimeoutMs"].(int64);ok{value.PublishTimeoutMs=n}};value.cond=sync.NewCond(&value.mu);return value}
func (s *AxInMemoryEventStore) enqueueAt(event AxEventEnvelope,commands []AxEventCommand,availableAt int64)error{encoded,_:=json.Marshal(event.value());size:=int64(len(encoded));if size>s.MaxEnvelopeBytes{return fmt.Errorf("event envelope exceeds %d bytes",s.MaxEnvelopeBytes)};fresh:=[]AxEventCommand{};for _,command:=range commands{if _,ok:=s.Deliveries[command.RouteID+":"+event.ID];!ok{fresh=append(fresh,command)}};deadline:=s.Clock.Now()+s.PublishTimeoutMs;for len(fresh)>0{pending:=0;for _,value:=range s.Deliveries{if value.Status=="queued"{pending++}};if pending+len(fresh)<=s.MaxPending&&s.QueuedBytes+size*int64(len(fresh))<=s.MaxQueuedBytes{break};remaining:=deadline-s.Clock.Now();if remaining<=0{return fmt.Errorf("AxEventBackpressureError: event inbox capacity timed out")};s.Clock.Sleep(time.Duration(min(remaining,50))*time.Millisecond,nil)};for _,command:=range fresh{s.sequence++;s.Deliveries[command.RouteID+":"+event.ID]=&axEventDelivery{Event:event,Command:command,Status:"queued",AvailableAt:availableAt,Sequence:s.sequence,Size:size};s.QueuedBytes+=size};return nil}
func (s *AxInMemoryEventStore) Enqueue(event AxEventEnvelope,commands []AxEventCommand)error{return s.enqueueAt(event,commands,s.Clock.Now())}
func (s *AxInMemoryEventStore) release(value *axEventDelivery){s.mu.Lock();s.QueuedBytes-=value.Size;if s.QueuedBytes<0{s.QueuedBytes=0};value.Size=0;s.cond.Broadcast();s.mu.Unlock()}
func (s *AxInMemoryEventStore) requeue(value *axEventDelivery,availableAt int64){encoded,_:=json.Marshal(value.Event.value());s.mu.Lock();value.Size=int64(len(encoded));value.Status="queued";value.AvailableAt=availableAt;s.QueuedBytes+=value.Size;s.cond.Broadcast();s.mu.Unlock()}
type AxPushEventSource struct { ID,IdentityScope,Trust string; publish func(AxEventEnvelope)error;publishScoped func(AxEventEnvelope,string,string)error }
func (s *AxPushEventSource) Start(publish func(AxEventEnvelope)error)error{s.publish=publish;return nil}
func (s *AxPushEventSource) StartScoped(publish func(AxEventEnvelope,string,string)error)error{s.publishScoped=publish;return nil}
func (s *AxPushEventSource) Publish(event AxEventEnvelope)error{if s.publishScoped!=nil{scope:=s.IdentityScope;if scope==""{scope="anonymous"};trust:=s.Trust;if trust==""{trust="untrusted"};return s.publishScoped(event,scope,trust)};if s.publish==nil{return fmt.Errorf("AxPushEventSource is not started")};return s.publish(event)}
func (s *AxPushEventSource) Close()error{s.publish=nil;s.publishScoped=nil;return nil}

type AxEventRuntime struct { Routes []AxEventRoute; Options map[string]Value; Descriptor map[string]Value; Store *AxInMemoryEventStore; Clock AxEventClock;targets map[string]AxEventTarget;sources []AxEventSource;active map[string]*AxEventCancellationToken;started bool;maxAttempts int;retryBackoffMs int64 }
func NewAxEventRuntime(routes []AxEventRoute, options map[string]Value) (*AxEventRuntime,error) {
	values:=make([]Value,0,len(routes)); for _,route:=range routes{values=append(values,route.value())}
	descriptor,err:=event_runtime_descriptor(values,options); if err!=nil{return nil,err}
	clock:=AxEventClock(AxSystemEventClock{});if configured,ok:=options["clock"].(AxEventClock);ok{clock=configured};maxAttempts:=3;if configured,ok:=options["maxAttempts"].(int);ok{maxAttempts=configured};retryBackoff:=int64(1_000);if configured,ok:=options["retryBackoffMs"].(int64);ok{retryBackoff=configured};return &AxEventRuntime{Routes:append([]AxEventRoute(nil),routes...),Options:options,Descriptor:asMap(descriptor),Store:NewAxInMemoryEventStoreWithClock(clock,options),Clock:clock,targets:map[string]AxEventTarget{},active:map[string]*AxEventCancellationToken{},maxAttempts:maxAttempts,retryBackoffMs:retryBackoff},nil
}
func (r *AxEventRuntime) RegisterTarget(target AxEventTarget){r.targets[target.ID]=target}
func (r *AxEventRuntime) AddSource(source AxEventSource){r.sources=append(r.sources,source)}
func (r *AxEventRuntime) Start()error{if r.started{return nil};r.started=true;for _,source:=range r.sources{var err error;if scoped,ok:=source.(AxScopedEventSource);ok{err=scoped.StartScoped(func(event AxEventEnvelope,scope,trust string)error{_,publishErr:=r.Publish(event,scope,trust);return publishErr})}else{err=source.Start(func(event AxEventEnvelope)error{_,publishErr:=r.Publish(event,"anonymous","untrusted");return publishErr})};if err!=nil{return err}};return nil}
func (r *AxEventRuntime) Plan(event AxEventEnvelope, identityScope, trust string) ([]AxEventCommand,error) {
	routes:=make([]Value,0,len(r.Routes)); for _,route:=range r.Routes{routes=append(routes,route.value())}
	value,err:=event_route_commands(event.value(),routes,identityScope,trust); if err!=nil{return nil,err}
	byID:=map[string]AxEventRoute{};for _,route:=range r.Routes{byID[route.ID]=route};out:=[]AxEventCommand{}; for _,item:=range asSlice(value){m:=asMap(item);routeID:=display(m["routeId"]);instanceKey:=display(m["instanceKey"]);if route:=byID[routeID];route.InstanceKey!=nil{resolved,resolveErr:=event_resolve_path(map[string]Value{"event":event.value(),"identity":map[string]Value{"scope":identityScope},"trust":trust,"correlation":event.Correlation},route.InstanceKey.value(),nil);if resolveErr!=nil{return nil,resolveErr};if resolved==nil{return nil,fmt.Errorf("route %s instance key was not present",routeID)};instanceKey=display(resolved)};out=append(out,AxEventCommand{RouteID:routeID,Action:display(m["action"]),TargetID:display(m["targetId"]),InstanceKey:instanceKey,IdempotencyKey:display(m["idempotencyKey"])})};return out,nil
}
func (r *AxEventRuntime) Publish(event AxEventEnvelope,identityScope,trust string)(AxEventPublishReceipt,error){if !r.started{return AxEventPublishReceipt{},fmt.Errorf("AxEventRuntime must be started first")};commands,err:=r.Plan(event,identityScope,trust);if err!=nil{return AxEventPublishReceipt{},err};ids:=[]string{};duplicate:=len(commands)>0;routes:=map[string]AxEventRoute{};for _,route:=range r.Routes{routes[route.ID]=route};for _,command:=range commands{id:=command.RouteID+":"+event.ID;ids=append(ids,id);if _,ok:=r.Store.Deliveries[id];!ok{duplicate=false};route:=routes[command.RouteID];if route.DebounceMs>0{for _,old:=range r.Store.Deliveries{if old.Status=="queued"&&old.Command.RouteID==command.RouteID&&old.Command.TargetID==command.TargetID&&old.Command.InstanceKey==command.InstanceKey{old.Status="coalesced";r.Store.release(old)}}};if err:=r.Store.enqueueAt(event,[]AxEventCommand{command},r.Clock.Now()+route.DebounceMs);err!=nil{return AxEventPublishReceipt{},err}};for _,id:=range ids{r.Store.Deliveries[id].IdentityScope=identityScope;r.Store.Deliveries[id].Trust=trust};if !duplicate{r.RunDue()};return AxEventPublishReceipt{event.ID,true,duplicate,"volatile",ids},nil}
func (r *AxEventRuntime) NextDueAt()*int64{var due *int64;for _,value:=range r.Store.Deliveries{if value.Status=="queued"&&(due==nil||value.AvailableAt<*due){candidate:=value.AvailableAt;due=&candidate}};return due}
func (r *AxEventRuntime) strictDeliveryEligible(candidate *axEventDelivery)bool{descriptor:=func(value *axEventDelivery)map[string]Value{ordering:="strict";for _,route:=range r.Routes{if route.ID==value.Command.RouteID{ordering=route.Ordering;break}};return map[string]Value{"sequence":value.Sequence,"targetId":value.Command.TargetID,"instanceKey":value.Command.InstanceKey,"status":value.Status,"ordering":ordering}};deliveries:=[]Value{};for _,value:=range r.Store.Deliveries{deliveries=append(deliveries,descriptor(value))};eligible,err:=event_strict_delivery_eligible(descriptor(candidate),deliveries);return err==nil&&coreTruthy(eligible)}
func (r *AxEventRuntime) RunDue()int{processed:=0;for{var due *axEventDelivery;for _,value:=range r.Store.Deliveries{if value.Status=="queued"&&value.AvailableAt<=r.Clock.Now()&&r.strictDeliveryEligible(value)&&(due==nil||value.AvailableAt<due.AvailableAt||value.AvailableAt==due.AvailableAt&&value.Sequence<due.Sequence){due=value}};if due==nil{return processed};due.Status="running";r.Store.release(due);r.dispatch(due.Event,due.Command,due.IdentityScope,due.Trust);processed++}}
func eventContinuationValue(value *AxEventContinuation)Value{if value==nil{return nil};return map[string]Value{"metadata":value.Metadata,"correlation":value.Correlation,"targetId":value.TargetID,"instanceKey":value.InstanceKey}}
func mapEventTargetInput(target AxEventTarget,event AxEventEnvelope,continuation *AxEventContinuation,action,identityScope,trust string)(Value,error){plan:=target.WakeInput;if action=="resume"{plan=target.ResumeInput};if plan==nil{plan=target.Input};var input Value;var err error;if plan!=nil{if target.Signature==nil{return nil,fmt.Errorf("target %s requires a signature for declarative input mapping",target.ID)};fields:=[]Value{};for _,field:=range target.Signature.Inputs{fields=append(fields,map[string]Value{"name":field.Name,"optional":field.IsOptional})};result,mapErr:=event_map_input(map[string]Value{"event":event.value(),"identity":map[string]Value{"scope":identityScope},"trust":trust,"correlation":event.Correlation},plan.value(),fields,eventContinuationValue(continuation));if mapErr!=nil{return nil,mapErr};mapped:=asMap(result);if !coreTruthy(mapped["ok"]){return nil,fmt.Errorf("%s",display(mapped["error"]))};input=mapped["value"]}else if target.MapInput!=nil{input,err=target.MapInput(event,continuation)}else{input=event.Data};if err!=nil{return nil,err};if target.Signature!=nil{fields:=[]Value{};for _,field:=range target.Signature.Inputs{fields=append(fields,map[string]Value{"name":field.Name,"optional":field.IsOptional})};normalized,normalizeErr:=event_normalize_input(input,fields);if normalizeErr!=nil{return nil,normalizeErr};result:=asMap(normalized);if !coreTruthy(result["ok"]){return nil,fmt.Errorf("%s",display(result["error"]))};input=result["value"];if _,validateErr:=validate_fields(target.Signature.Inputs,input,"input");validateErr!=nil{return nil,validateErr}};return input,nil}
func (r *AxEventRuntime) dispatch(event AxEventEnvelope,command AxEventCommand,identityScope,trust string){deliveryID:=command.RouteID+":"+event.ID;delivery:=r.Store.Deliveries[deliveryID];targetID:=command.TargetID;var continuation *AxEventContinuation;if command.Action=="resume"{continuation=r.findContinuation(event.Correlation,identityScope);if continuation==nil{r.deadLetter(deliveryID,"","continuation_not_found","");return};targetID=continuation.TargetID};if command.Action=="observe"||command.Action=="invalidate"{delivery.Status="succeeded";return};target,ok:=r.targets[targetID];if !ok{r.deadLetter(deliveryID,"","unknown_target:"+targetID,"");return};runID:=delivery.RunID;run:=r.Store.Runs[runID];if run==nil{runID=fmt.Sprintf("run:%s:%d",deliveryID,len(r.Store.Runs)+1);run=&AxEventRun{ID:runID,DeliveryID:deliveryID,RouteID:command.RouteID,TargetID:target.ID,InstanceKey:command.InstanceKey,Status:"queued"};r.Store.Runs[runID]=run;delivery.RunID=runID};token:=&AxEventCancellationToken{};r.active[runID]=token;defer delete(r.active,runID);stateKey:=target.ID+"\n"+identityScope+"\n"+command.InstanceKey;if target.RestoreState!=nil{if state,ok:=r.Store.ProgramState[stateKey];ok{if err:=target.RestoreState(state);err!=nil{r.deadLetter(deliveryID,runID,err.Error(),"");return}}};input,err:=mapEventTargetInput(target,event,continuation,command.Action,identityScope,trust);if err!=nil{run.Status="failed";run.Error="event_input_invalid:"+err.Error();r.deadLetter(deliveryID,runID,run.Error,"");return};delivery.Attempt++;attempt:=delivery.Attempt;run.Attempt=attempt;run.Status="running";output,invokeErr:=target.Invoke(input,map[string]Value{"runId":runID,"deliveryId":deliveryID,"instanceKey":command.InstanceKey,"identityScope":identityScope,"idempotencyKey":command.IdempotencyKey,"cancellation":token,"continuation":continuation});if token.IsCancelled(){run.Status="cancelled";delivery.Status="cancelled";return};if invokeErr!=nil{if attempt<r.maxAttempts&&target.RetrySafety=="idempotent"{run.Status="queued";r.Store.requeue(delivery,r.Clock.Now()+r.retryBackoffMs*(1<<uint(attempt-1)));return};if target.RetrySafety=="idempotent"{run.Status="failed"}else{run.Status="outcome_unknown"};run.Error=invokeErr.Error();delivery.Status=run.Status;r.deadLetter(deliveryID,runID,run.Error,"");return};if target.CaptureState!=nil{if state,stateErr:=target.CaptureState();stateErr==nil{r.Store.ProgramState[stateKey]=state}};run.Output=output;ids,registerErr:=r.registerDeclared(target,event,command,identityScope);if registerErr!=nil{run.Status="failed";run.Error="event_input_invalid:"+registerErr.Error();r.deadLetter(deliveryID,runID,run.Error,"");return};run.ContinuationIDs=ids;if len(ids)>0{run.Status="waiting_event";delivery.Status="waiting_event"}else{run.Status="succeeded";delivery.Status="succeeded";for sinkID,sink:=range target.Sinks{if sinkErr:=sink.Write(output,map[string]Value{"run":run,"idempotencyKey":runID+":"+sinkID});sinkErr!=nil{r.deadLetter(deliveryID,runID,sinkErr.Error(),sinkID)}}};if continuation!=nil{continuation.Completed=true}}
func (r *AxEventRuntime) registerDeclared(target AxEventTarget,event AxEventEnvelope,command AxEventCommand,scope string)([]string,error){ids:=[]string{};for _,declaration:=range target.WaitFor{kind:=display(declaration["kind"]);raw:=declaration["value"];var value Value;if path,ok:=raw.(map[string]Value);ok&&path["root"]!=nil{resolved,err:=event_resolve_path(map[string]Value{"event":event.value(),"identity":map[string]Value{"scope":scope},"correlation":event.Correlation},path,nil);if err!=nil{return nil,err};value=resolved}else if key,ok:=raw.(string);ok{value=coreGet(asMap(event.Data),key,nil)}else{value=raw};if value==nil{return nil,fmt.Errorf("continuation value is missing")};id:=fmt.Sprintf("continuation:%s:%d",target.ID,len(r.Store.Continuations)+1);metadata:=asMap(coreGet(declaration,"metadata",Object()));expires:=int64(0);if duration,ok:=declaration["expiresInMs"].(int64);ok{expires=r.Clock.Now()+duration};r.Store.Continuations[id]=&AxEventContinuation{ID:id,TargetID:target.ID,InstanceKey:command.InstanceKey,IdentityScope:scope,Correlation:[]map[string]string{{"kind":kind,"value":display(value)}},Metadata:metadata,ExpiresAt:expires};ids=append(ids,id)};return ids,nil}
func (r *AxEventRuntime) findContinuation(keys []map[string]string,scope string)*AxEventContinuation{for _,continuation:=range r.Store.Continuations{if continuation.Completed||continuation.IdentityScope!=scope||(continuation.ExpiresAt>0&&continuation.ExpiresAt<=r.Clock.Now()){continue};for _,left:=range continuation.Correlation{for _,right:=range keys{if left["kind"]==right["kind"]&&left["value"]==right["value"]{return continuation}}}};return nil}
func (r *AxEventRuntime) deadLetter(deliveryID,runID,reason,sinkID string){id:=fmt.Sprintf("dead:%d",len(r.Store.DeadLetters)+1);r.Store.DeadLetters[id]=AxEventDeadLetter{id,deliveryID,runID,sinkID,reason};if sinkID==""{if delivery:=r.Store.Deliveries[deliveryID];delivery!=nil{delivery.Status="dead_lettered"}}}
func (r *AxEventRuntime) CancelRun(runID,reason string)bool{token:=r.active[runID];if token==nil{return false};token.Cancel(reason);return true}
func (r *AxEventRuntime) GetRun(runID string)*AxEventRun{return r.Store.Runs[runID]}
func (r *AxEventRuntime) ListDeadLetters()[]AxEventDeadLetter{out:=[]AxEventDeadLetter{};for _,dead:=range r.Store.DeadLetters{out=append(out,dead)};return out}
func (r *AxEventRuntime) Redrive(deadID string)error{dead,ok:=r.Store.DeadLetters[deadID];if !ok{return fmt.Errorf("unknown dead letter %s",deadID)};delete(r.Store.DeadLetters,deadID);if dead.SinkID!=""{run:=r.Store.Runs[dead.RunID];if run==nil{return fmt.Errorf("sink redrive run is unavailable")};target,ok:=r.targets[run.TargetID];if !ok{return fmt.Errorf("sink redrive target is unavailable")};sink,ok:=target.Sinks[dead.SinkID];if !ok{return fmt.Errorf("sink redrive sink is unavailable")};if err:=sink.Write(run.Output,map[string]Value{"run":run,"idempotencyKey":run.ID+":"+dead.SinkID});err!=nil{r.Store.DeadLetters[deadID]=dead;return err};return nil};delivery:=r.Store.Deliveries[dead.DeliveryID];delivery.Attempt=0;r.Store.requeue(delivery,r.Clock.Now());r.RunDue();return nil}
func (r *AxEventRuntime) Close()error{for _,source:=range r.sources{_ = source.Close()};r.started=false;return nil}
func NormalizeMCPEvent(namespace, method string, params Value) (map[string]Value,error) { value,err:=event_normalize_mcp(namespace,method,params);return asMap(value),err }

type AxExecutionContext struct {
	MCP []*AxMCPClient
	UCP []*AxUCPClient
	initialized map[*AxMCPClient]bool
	mu sync.Mutex
}

func NewAxExecutionContext(mcp []*AxMCPClient, ucp []*AxUCPClient) (*AxExecutionContext, error) {
	c := &AxExecutionContext{MCP:append([]*AxMCPClient(nil),mcp...), UCP:append([]*AxUCPClient(nil),ucp...), initialized:map[*AxMCPClient]bool{}}
	seen := map[string]bool{}
	for _, namespace := range c.Namespaces() { if seen[namespace] { return nil, fmt.Errorf("MCP/UCP namespace collision %s", namespace) }; seen[namespace]=true }
	return c,nil
}

func (c *AxExecutionContext) Initialize() error {
	c.mu.Lock(); defer c.mu.Unlock()
	for _, client := range c.MCP { if !c.initialized[client] { if err:=client.Init(); err!=nil{return err}; c.initialized[client]=true } }
	return nil
}

func (c *AxExecutionContext) NativeTools() ([]Tool,error) {
	if err:=c.Initialize(); err!=nil{return nil,err}
	out:=[]Tool{}; for _,client:=range c.MCP{out=append(out,client.NativeTools()...)}; for _,client:=range c.UCP{out=append(out,client.NativeTools()...)}
	seen:=map[string]bool{}; for _,tool:=range out{if seen[tool.Name]{return nil,fmt.Errorf("MCP/UCP tool collision %s",tool.Name)};seen[tool.Name]=true}; return out,nil
}

func (c *AxExecutionContext) RuntimeModules() []Value {
	out:=[]Value{}; for _,client:=range c.MCP{out=append(out,map[string]Value{"name":"mcp."+client.Namespace(),"functions":client.NativeTools(),"client":client})}; for _,client:=range c.UCP{out=append(out,map[string]Value{"name":"ucp."+client.Namespace(),"functions":client.NativeTools(),"client":client})}; return out
}

func (c *AxExecutionContext) Namespaces() []string { out:=[]string{};for _,client:=range c.MCP{out=append(out,client.Namespace())};for _,client:=range c.UCP{out=append(out,client.Namespace())};return out }
func (c *AxExecutionContext) Derive(inheritance Value) *AxExecutionContext { if display(inheritance)=="none"{empty,_:=NewAxExecutionContext(nil,nil);return empty};allowed:=map[string]bool{};for _,raw:=range asSlice(inheritance){allowed[display(raw)]=true};if len(allowed)==0{return c};mcp:=[]*AxMCPClient{};ucp:=[]*AxUCPClient{};for _,x:=range c.MCP{if allowed[x.Namespace()]{mcp=append(mcp,x)}};for _,x:=range c.UCP{if allowed[x.Namespace()]{ucp=append(ucp,x)}};out,_:=NewAxExecutionContext(mcp,ucp);return out }
func (c *AxExecutionContext) ContinuationState() AxMCPContinuationState { names:=c.Namespaces();sum:=sha256.Sum256([]byte(strings.Join(names,"\n")));return AxMCPContinuationState{Namespaces:names,Tasks:[]map[string]Value{},Subscriptions:[]map[string]Value{},CatalogFingerprint:fmt.Sprintf("%x",sum)} }

func ResolveAxExecutionContext(options map[string]Value,parent *AxExecutionContext)(*AxExecutionContext,error){if options==nil{options=map[string]Value{}};if raw:=coreGet(options,"executionContext",coreGet(options,"mcpExecutionContext",nil));raw!=nil{if c,ok:=raw.(*AxExecutionContext);ok{return c.Derive(coreGet(options,"mcpInheritance","all")),nil}};if _,ok:=options["mcp"];ok||options["ucp"]!=nil{mcp:=[]*AxMCPClient{};for _,raw:=range asSlice(coreGet(options,"mcp",Array())){if c,ok:=raw.(*AxMCPClient);ok{mcp=append(mcp,c)}};if c,ok:=coreGet(options,"mcp",nil).(*AxMCPClient);ok{mcp=append(mcp,c)};ucp:=[]*AxUCPClient{};for _,raw:=range asSlice(coreGet(options,"ucp",Array())){if c,ok:=raw.(*AxUCPClient);ok{ucp=append(ucp,c)}};if c,ok:=coreGet(options,"ucp",nil).(*AxUCPClient);ok{ucp=append(ucp,c)};return NewAxExecutionContext(mcp,ucp)};if parent!=nil{return parent.Derive(coreGet(options,"mcpInheritance","all")),nil};return nil,nil}

func (c *AxMCPClient) request(method string, params map[string]Value) (map[string]Value, error) {
	id := fmt.Sprintf("%d", c.nextID); c.nextID++
	msg := map[string]Value{"jsonrpc":"2.0", "id":id, "method":method}
	if params != nil { msg["params"] = params }
	response, err := c.transport.Send(msg)
	if err != nil { return nil, err }
	if rawErr := coreGet(response, "error", nil); rawErr != nil {
		er := asMap(rawErr)
		return nil, AxError{Category:"mcp", Message:display(coreGet(er, "message", "MCP JSON-RPC error"))}
	}
	return asMap(coreGet(response, "result", Object())), nil
}

func (c *AxMCPClient) clientCapabilities() map[string]Value {
	out := map[string]Value{}
	for key, value := range asMap(coreGet(c.options, "capabilities", Object())) { out[key] = value }
	if coreGet(c.options, "roots", nil) != nil {
		if _, ok := out["roots"]; !ok { out["roots"] = map[string]Value{"listChanged":true} }
	}
	return out
}

func (c *AxMCPClient) capability(name string) bool {
	value, ok := c.serverCapabilities[name]
	return ok && value != nil && value != false
}

func (c *AxMCPClient) handleInboundMessage(message map[string]Value) {
	method:=display(coreGet(message,"method",""))
	if method == "roots/list" && coreGet(message, "id", nil) != nil {
		_ = c.transport.SendResponse(map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil), "result":map[string]Value{"roots":coreGet(c.options, "roots", Array())}})
	}
	if method=="notifications/tools/list_changed"||method=="notifications/prompts/list_changed"||method=="notifications/resources/list_changed"{_ = c.Refresh()}
	if callback,ok:=c.options["onNotification"].(func(map[string]Value));ok{callback(message)}
	listeners:=make([]func(map[string]Value),0,len(c.notificationListeners));for _,listener:=range c.notificationListeners{listeners=append(listeners,listener)};for _,listener:=range listeners{listener(message)}
}

type AxMCPResourceSubscriptionPolicy struct{Mode string;URIs []string;Select func(map[string]Value,AxMCPCatalogSnapshot)bool}
func AxMCPSubscribeNone()AxMCPResourceSubscriptionPolicy{return AxMCPResourceSubscriptionPolicy{Mode:"none"}}
func AxMCPSubscribeAll()AxMCPResourceSubscriptionPolicy{return AxMCPResourceSubscriptionPolicy{Mode:"all"}}
func AxMCPSubscribeURIs(uris ...string)AxMCPResourceSubscriptionPolicy{return AxMCPResourceSubscriptionPolicy{Mode:"explicit",URIs:append([]string(nil),uris...)}}
func AxMCPSelectResources(selectResource func(map[string]Value,AxMCPCatalogSnapshot)bool)AxMCPResourceSubscriptionPolicy{return AxMCPResourceSubscriptionPolicy{Mode:"selector",Select:selectResource}}
type AxMCPEventSource struct { Client *AxMCPClient; Namespace,IdentityScope,Trust string; Policy AxMCPResourceSubscriptionPolicy;Subscriptions []string;Errors []error;owner string; publish func(AxEventEnvelope,string,string)error; remove,removeLifecycle func(); nextID int }
func NewAxMCPEventSource(client *AxMCPClient,namespace,identityScope,trust string,subscriptions []string)*AxMCPEventSource{policy:=AxMCPSubscribeNone();if len(subscriptions)>0{policy=AxMCPSubscribeURIs(subscriptions...)};return NewAxMCPEventSourceWithPolicy(client,namespace,identityScope,trust,policy)}
func NewAxMCPEventSourceWithPolicy(client *AxMCPClient,namespace,identityScope,trust string,policy AxMCPResourceSubscriptionPolicy)*AxMCPEventSource{if namespace==""{namespace=client.Namespace()};if identityScope==""{identityScope="anonymous"};if trust==""{trust="untrusted"};if policy.Mode==""{policy.Mode="none"};source:=&AxMCPEventSource{Client:client,Namespace:namespace,IdentityScope:identityScope,Trust:trust,Policy:policy,nextID:1};source.owner=fmt.Sprintf("event-source:%p",source);return source}
func (s *AxMCPEventSource) Start(publish func(AxEventEnvelope)error)error{return s.StartScoped(func(event AxEventEnvelope,_ string,_ string)error{return publish(event)})}
func (s *AxMCPEventSource) StartScoped(publish func(AxEventEnvelope,string,string)error)error{if err:=s.Client.Init();err!=nil{return err};s.publish=publish;s.remove=s.Client.AddNotificationListener(s.onNotification);s.removeLifecycle=s.Client.AddLifecycleListener(func(state string){if state=="reconnected"{_ = s.reconcile()}});return s.reconcile()}
func (s *AxMCPEventSource) selected(catalog AxMCPCatalogSnapshot)([]string,error){mode:=s.Policy.Mode;if mode==""{mode="none"};candidates:=[]Value{};explicit:=[]string{};switch mode{case "none":case "all":for _,resource:=range catalog.Resources{candidates=append(candidates,resource)};case "explicit":explicit=append(explicit,s.Policy.URIs...);case "selector":if s.Policy.Select==nil{return nil,fmt.Errorf("MCP selector policy requires Select")};for _,resource:=range catalog.Resources{if s.Policy.Select(resource,catalog){candidates=append(candidates,resource)}};default:return nil,fmt.Errorf("invalid MCP resource subscription policy %s",mode)};raw,err:=mcp_resource_subscription_selection(candidates,mode,explicit);if err!=nil{return nil,err};out:=[]string{};for _,value:=range asSlice(raw){out=append(out,display(value))};sort.Strings(out);return out,nil}
func (s *AxMCPEventSource) reconcile()error{catalog,err:=s.Client.InspectCatalog(false);if err!=nil{return err};if s.Policy.Mode!="none"&&!coreTruthy(coreGet(coreGet(catalog.ServerCapabilities,"resources",Object()),"subscribe",false)){return fmt.Errorf("MCP server %s does not advertise resource subscriptions",catalog.Namespace)};desired,err:=s.selected(catalog);if err!=nil{return err};raw,err:=mcp_resource_subscription_plan(desired,s.Subscriptions);if err!=nil{return err};plan:=asMap(raw);for _,value:=range asSlice(plan["removals"]){uri:=display(value);if _,releaseErr:=s.Client.ReleaseResourceSubscription(uri,s.owner);releaseErr!=nil{s.Errors=append(s.Errors,releaseErr)}else{s.Subscriptions=removeString(s.Subscriptions,uri)}};for _,value:=range asSlice(plan["additions"]){uri:=display(value);if _,acquireErr:=s.Client.AcquireResourceSubscription(uri,s.owner);acquireErr!=nil{s.Errors=append(s.Errors,acquireErr)}else{s.Subscriptions=append(s.Subscriptions,uri);sort.Strings(s.Subscriptions)}};return nil}
func removeString(values []string,target string)[]string{out:=values[:0];for _,value:=range values{if value!=target{out=append(out,value)}};return out}
func (s *AxMCPEventSource) onNotification(message map[string]Value){method:=display(coreGet(message,"method",""));if method==""||s.publish==nil{return};if method=="notifications/resources/list_changed"{_ = s.reconcile()};normalized,err:=NormalizeMCPEvent(s.Namespace,method,coreGet(message,"params",Object()));if err!=nil{return};correlations:=[]map[string]string{};if raw:=asMap(coreGet(normalized,"correlation",Object()));len(raw)>0{correlations=append(correlations,map[string]string{"kind":display(raw["kind"]),"value":display(raw["value"])})};data:=coreGet(normalized,"data",Object());subject:=display(coreGet(data,"uri",coreGet(coreGet(data,"task",Object()),"taskId","")));event:=AxEventEnvelope{SpecVersion:"1.0",ID:fmt.Sprintf("mcp:%s:%d",s.Namespace,s.nextID),Source:display(normalized["source"]),Type:display(normalized["type"]),Subject:subject,Data:data,Correlation:correlations};s.nextID++;_ = s.publish(event,s.IdentityScope,s.Trust)}
func (s *AxMCPEventSource) Reconnect()error{if err:=s.Client.RestoreResourceSubscriptions();err!=nil{return err};return s.reconcile()}
func (s *AxMCPEventSource) Close()error{for _,uri:=range append([]string(nil),s.Subscriptions...){_,_ = s.Client.ReleaseResourceSubscription(uri,s.owner)};s.Subscriptions=nil;if s.remove!=nil{s.remove()};if s.removeLifecycle!=nil{s.removeLifecycle()};s.remove=nil;s.removeLifecycle=nil;s.publish=nil;return nil}

func (c *AxMCPClient) toolToFunction(tool map[string]Value) Tool {
	original := display(coreGet(tool, "name", ""))
	name := c.overrideName(original)
	desc := c.overrideDescription(tool)
	return Tool{Name:name, Description:desc, Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) {
		result, err := c.CallTool(original, args)
		if err != nil { return nil, err }
		if value := coreGet(result, "structuredContent", nil); value != nil { return value, nil }
		return map[string]Value{"content": contentText(asSlice(coreGet(result, "content", Array())))}, nil
	}}
}

func (c *AxMCPClient) promptToFunction(prompt map[string]Value) Tool {
	original := display(coreGet(prompt, "name", ""))
	return Tool{Name:c.overrideName("prompt_"+original), Description:c.overrideDescription(prompt), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.GetPrompt(original, args) }}
}

func (c *AxMCPClient) resourceToFunction(resource map[string]Value) Tool {
	uri := display(coreGet(resource, "uri", ""))
	name := c.overrideName("resource_"+safeMCPName(display(coreGet(resource, "name", uri))))
	return Tool{Name:name, Description:c.overrideDescription(resource), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.ReadResource(uri) }}
}

func (c *AxMCPClient) resourceTemplateToFunction(templ map[string]Value) Tool {
	name := c.overrideName("resource_template_"+safeMCPName(display(coreGet(templ, "name", "template"))))
	return Tool{Name:name, Description:c.overrideDescription(templ), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.ReadResource(display(coreGet(args, "uri", ""))) }}
}

func (c *AxMCPClient) overrideName(name string) string {
	for _, raw := range asSlice(coreGet(c.options, "functionOverrides", Array())) {
		item := asMap(raw)
		if display(coreGet(item, "name", "")) == name { return display(coreGet(coreGet(item, "updates", Object()), "name", name)) }
	}
	return name
}

func (c *AxMCPClient) overrideDescription(item map[string]Value) string {
	name := display(coreGet(item, "name", ""))
	desc := display(coreGet(item, "description", coreGet(item, "title", name)))
	for _, raw := range asSlice(coreGet(c.options, "functionOverrides", Array())) {
		over := asMap(raw)
		if display(coreGet(over, "name", "")) == name { return display(coreGet(coreGet(over, "updates", Object()), "description", desc)) }
	}
	return desc
}

type AxMCPStreamableHTTPTransport struct {
	Endpoint string
	Options map[string]Value
	Headers map[string]string
	SessionID string
	ProtocolVersion string
	LastHeaders map[string]string
	handler func(map[string]Value)
	lifecycleHandler func(string)
	client *http.Client
	OAuth *AxMCPOAuthOptions
	listenMu sync.Mutex
	listenCancel context.CancelFunc
	listenDone chan struct{}
	listenBody io.ReadCloser
	lastEventID string
}

func NewAxMCPStreamableHTTPTransport(endpoint string, options map[string]Value) (*AxMCPStreamableHTTPTransport, error) {
	if options == nil { options = map[string]Value{} }
	checked, err := AxMCPValidateEndpoint(endpoint, asMap(coreGet(options, "ssrfProtection", Object())))
	if err != nil { return nil, err }
	t := &AxMCPStreamableHTTPTransport{Endpoint:checked, Options:options, Headers:map[string]string{}, client:&http.Client{Timeout:30*time.Second}}
	for key, value := range asMap(coreGet(options, "headers", Object())) { t.Headers[key] = display(value) }
	if auth := display(coreGet(options, "authorization", "")); auth != "" { t.Headers["Authorization"] = auth }
	return t, nil
}

func (t *AxMCPStreamableHTTPTransport) Send(message map[string]Value) (map[string]Value, error) {
	body, _ := json.Marshal(message)
	req, err := http.NewRequest("POST", t.Endpoint, bytes.NewReader(body))
	if err != nil { return nil, err }
	for key, value := range t.BuildHeaders(map[string]string{"Content-Type":"application/json", "Accept":"application/json, text/event-stream"}, display(coreGet(message, "method", "")) != "initialize") { req.Header.Set(key, value) }
	res, err := t.client.Do(req)
	if err != nil { return nil, err }
	defer res.Body.Close()
	if sid := res.Header.Get("MCP-Session-Id"); sid != "" { t.SessionID = sid }
	if res.StatusCode == 401 && t.ApplyOAuth() { return t.Send(message) }
	if res.StatusCode < 200 || res.StatusCode >= 300 { return nil, AxError{Category:"mcp", Message:fmt.Sprintf("HTTP error %d", res.StatusCode)} }
	data, _ := io.ReadAll(res.Body)
	if len(strings.TrimSpace(string(data))) == 0 { return map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil), "result":map[string]Value{}}, nil }
	// A spec-compliant MCP server may answer a JSON-RPC POST with an SSE stream
	// (Content-Type: text/event-stream) carrying the response — and any interleaved
	// notifications/keepalives — in `data:` frames; parse those rather than
	// JSON-decoding the raw stream. Otherwise keep the JSON path.
	if strings.Contains(strings.ToLower(res.Header.Get("Content-Type")), "text/event-stream") {
		return t.selectSSEResponse(iterSSE(string(data)), coreGet(message, "id", nil)), nil
	}
	return asMap(ParseJSON(string(data))), nil
}

// selectSSEResponse returns the JSON-RPC response whose id matches the request
// from the `data:` frames of an SSE answer, routing any interleaved server
// notifications/requests to the inbound handler (mirroring the stdio transport).
func (t *AxMCPStreamableHTTPTransport) selectSSEResponse(messages []Value, requestID Value) map[string]Value {
	var response map[string]Value
	for _, msg := range messages {
		m := asMap(msg)
		if response == nil {
			if id, ok := m["id"]; ok && display(id) == display(requestID) {
				response = m
				continue
			}
		}
		if t.handler != nil { t.handler(m) }
	}
	if response != nil { return response }
	if len(messages) > 0 { return asMap(messages[len(messages)-1]) }
	return map[string]Value{"jsonrpc":"2.0", "id":requestID, "result":map[string]Value{}}
}

func (t *AxMCPStreamableHTTPTransport) SendNotification(message map[string]Value) error { _, err := t.Send(message); return err }
func (t *AxMCPStreamableHTTPTransport) SendResponse(message map[string]Value) error { _, err := t.Send(message); return err }
func (t *AxMCPStreamableHTTPTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPStreamableHTTPTransport) SetLifecycleHandler(handler func(string)) { t.lifecycleHandler = handler }
func (t *AxMCPStreamableHTTPTransport) SetProtocolVersion(protocolVersion string) { t.ProtocolVersion = protocolVersion }
func (t *AxMCPStreamableHTTPTransport) Connect() error { return nil }

func (t *AxMCPStreamableHTTPTransport) StartListening() error {
	t.listenMu.Lock()
	defer t.listenMu.Unlock()
	if t.listenCancel != nil { return nil }
	ctx, cancel := context.WithCancel(context.Background())
	t.listenCancel = cancel
	t.listenDone = make(chan struct{})
	go t.listenLoop(ctx, t.listenDone)
	return nil
}

func (t *AxMCPStreamableHTTPTransport) listenLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	connectedOnce := false
	delay := 100 * time.Millisecond
	if raw := coreGet(t.Options, "reconnectDelayMs", nil); raw != nil { delay = time.Duration(num(raw)) * time.Millisecond }
	for ctx.Err() == nil {
		req, err := http.NewRequestWithContext(ctx, "GET", t.Endpoint, nil)
		if err == nil {
			for key, value := range t.BuildHeaders(map[string]string{"Accept":"text/event-stream"}, true) { req.Header.Set(key, value) }
			if t.lastEventID != "" { req.Header.Set("Last-Event-ID", t.lastEventID) }
			res, requestErr := t.client.Do(req)
			if requestErr == nil && res.StatusCode >= 200 && res.StatusCode < 300 {
				if sid := res.Header.Get("MCP-Session-Id"); sid != "" { t.SessionID = sid }
				t.listenMu.Lock(); t.listenBody = res.Body; t.listenMu.Unlock()
				if connectedOnce && t.lifecycleHandler != nil { t.lifecycleHandler("reconnected") }
				connectedOnce = true
				t.consumeSSE(ctx, res.Body)
				_ = res.Body.Close()
				t.listenMu.Lock(); if t.listenBody == res.Body { t.listenBody = nil }; t.listenMu.Unlock()
				if ctx.Err() == nil && t.lifecycleHandler != nil { t.lifecycleHandler("disconnected") }
			} else if requestErr == nil {
				_ = res.Body.Close()
			}
		}
		if ctx.Err() != nil { break }
		timer := time.NewTimer(delay)
		select { case <-ctx.Done(): timer.Stop(); case <-timer.C: }
	}
}

func (t *AxMCPStreamableHTTPTransport) consumeSSE(ctx context.Context, body io.Reader) {
	scanner := bufio.NewScanner(body)
	data := []string{}
	eventID := ""
	dispatch := func() {
		if eventID != "" { t.lastEventID = eventID }
		if len(data) > 0 && t.handler != nil {
			var message map[string]Value
			if json.Unmarshal([]byte(strings.Join(data, "\n")), &message) == nil { t.handler(message) }
		}
		data = nil; eventID = ""
	}
	for scanner.Scan() && ctx.Err() == nil {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		switch {
		case line == "": dispatch()
		case strings.HasPrefix(line, "id:"): eventID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		case strings.HasPrefix(line, "data:"): data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if len(data) > 0 { dispatch() }
}

func (t *AxMCPStreamableHTTPTransport) Close() error {
	t.listenMu.Lock()
	cancel, done, body := t.listenCancel, t.listenDone, t.listenBody
	t.listenCancel = nil; t.listenDone = nil; t.listenBody = nil
	t.listenMu.Unlock()
	if cancel != nil { cancel() }
	if body != nil { _ = body.Close() }
	if done != nil { select { case <-done: case <-time.After(2*time.Second): } }
	return nil
}

func (t *AxMCPStreamableHTTPTransport) BuildHeaders(base map[string]string, includeProtocol bool) map[string]string {
	out := map[string]string{}
	for key, value := range t.Headers { out[key] = value }
	for key, value := range base { out[key] = value }
	if t.SessionID != "" { out["MCP-Session-Id"] = t.SessionID }
	if includeProtocol && t.ProtocolVersion != "" { out["MCP-Protocol-Version"] = t.ProtocolVersion }
	t.LastHeaders = out
	return out
}

func (t *AxMCPStreamableHTTPTransport) ApplyOAuth() bool {
	if t.OAuth == nil { return false }
	if t.OAuth.TokenStore != nil {
		token, _ := t.OAuth.TokenStore.GetToken(t.Endpoint)
		if token != nil && token.AccessToken != "" {
			t.Headers["Authorization"] = "Bearer " + token.AccessToken
			return true
		}
	}
	if t.OAuth.OnAuthCode == nil { return false }
	verifier := AxMCPPKCEVerifier()
	challenge := AxMCPPKCEChallenge(verifier)
	auth, err := t.OAuth.OnAuthCode(t.Endpoint+"?response_type=code&code_challenge="+url.QueryEscape(challenge)+"&code_challenge_method=S256")
	if err != nil || auth["code"] == "" { return false }
	token := AxMCPTokenSet{AccessToken:"mcp-auth-code-"+auth["code"], Issuer:t.Endpoint}
	if t.OAuth.TokenStore != nil { _ = t.OAuth.TokenStore.SetToken(t.Endpoint, token) }
	t.Headers["Authorization"] = "Bearer " + token.AccessToken
	return true
}

type AxMCPStdioTransport struct {
	cmd *exec.Cmd
	stdin io.WriteCloser
	stdout *bufio.Reader
	mu sync.Mutex
	handler func(map[string]Value)
	protocolVersion string
}

func NewAxMCPStdioTransport(command string, args []string) (*AxMCPStdioTransport, error) {
	cmd := exec.Command(command, args...)
	in, err := cmd.StdinPipe(); if err != nil { return nil, err }
	out, err := cmd.StdoutPipe(); if err != nil { return nil, err }
	if err := cmd.Start(); err != nil { return nil, err }
	return &AxMCPStdioTransport{cmd:cmd, stdin:in, stdout:bufio.NewReader(out)}, nil
}

func (t *AxMCPStdioTransport) Send(message map[string]Value) (map[string]Value, error) {
	t.mu.Lock(); defer t.mu.Unlock()
	if _, err := io.WriteString(t.stdin, AxMCPStdioEncode(message)); err != nil { return nil, err }
	for {
		line, err := t.stdout.ReadString('\n')
		if err != nil { return nil, err }
		parsed, err := AxMCPStdioDecode(line)
		if err != nil { continue }
		if display(coreGet(parsed, "id", nil)) == display(coreGet(message, "id", nil)) { return parsed, nil }
		if t.handler != nil { t.handler(parsed) }
	}
}

func (t *AxMCPStdioTransport) SendNotification(message map[string]Value) error { _, err := io.WriteString(t.stdin, AxMCPStdioEncode(message)); return err }
func (t *AxMCPStdioTransport) SendResponse(message map[string]Value) error { return t.SendNotification(message) }
func (t *AxMCPStdioTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPStdioTransport) SetLifecycleHandler(handler func(string)) {}
func (t *AxMCPStdioTransport) SetProtocolVersion(protocolVersion string) { t.protocolVersion = protocolVersion }
func (t *AxMCPStdioTransport) Connect() error { return nil }
func (t *AxMCPStdioTransport) StartListening() error { return nil }
func (t *AxMCPStdioTransport) Close() error { return t.cmd.Process.Kill() }

type AxMCPScriptedTransport struct {
	Responses []Value
	Requests []map[string]Value
	Notifications []map[string]Value
	SentResponses []map[string]Value
	ProtocolVersion string
	handler func(map[string]Value)
}

func NewAxMCPScriptedTransport(responses []Value) *AxMCPScriptedTransport { return &AxMCPScriptedTransport{Responses:append([]Value(nil), responses...)} }
func (t *AxMCPScriptedTransport) Connect() error { return nil }
func (t *AxMCPScriptedTransport) SetProtocolVersion(protocolVersion string) { t.ProtocolVersion = protocolVersion }
func (t *AxMCPScriptedTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPScriptedTransport) SetLifecycleHandler(handler func(string)) {}
func (t *AxMCPScriptedTransport) StartListening() error { return nil }
func (t *AxMCPScriptedTransport) Close() error { return nil }
func (t *AxMCPScriptedTransport) Send(message map[string]Value) (map[string]Value, error) {
	t.Requests = append(t.Requests, cloneMCPMap(message))
	method := display(coreGet(message, "method", ""))
	match := -1
	for i, raw := range t.Responses {
		if display(coreGet(raw, "method", method)) == method { match = i; break }
	}
	raw := Value(map[string]Value{"result":map[string]Value{}})
	if match >= 0 { raw = t.Responses[match]; t.Responses = append(t.Responses[:match], t.Responses[match+1:]...) }
	out := map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil)}
	if errValue := coreGet(raw, "error", nil); errValue != nil { out["error"] = errValue } else { out["result"] = coreGet(raw, "result", Object()) }
	return out, nil
}
func (t *AxMCPScriptedTransport) SendNotification(message map[string]Value) error { t.Notifications = append(t.Notifications, cloneMCPMap(message)); return nil }
func (t *AxMCPScriptedTransport) SendResponse(message map[string]Value) error { t.SentResponses = append(t.SentResponses, cloneMCPMap(message)); return nil }
func (t *AxMCPScriptedTransport) Emit(message map[string]Value) { if t.handler != nil { t.handler(message) } }

func AxMCPStdioEncode(message map[string]Value) string { data, _ := json.Marshal(message); return string(data)+"\n" }
func AxMCPStdioDecode(line string) (map[string]Value, error) { var out map[string]Value; err := json.Unmarshal([]byte(strings.TrimSpace(line)), &out); return out, err }
func AxMCPPKCEVerifier() string { return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano()))) }
func AxMCPPKCEChallenge(verifier string) string { sum := sha256.Sum256([]byte(verifier)); return base64.RawURLEncoding.EncodeToString(sum[:]) }

func AxMCPValidateEndpoint(endpoint string, options map[string]Value) (string, error) {
	u, err := url.Parse(endpoint); if err != nil { return "", err }
	if u.Scheme != "http" && u.Scheme != "https" { return "", AxError{Category:"mcp", Message:"MCP endpoint must use http or https"} }
	requireHTTPS := coreGet(options, "requireHttps", coreGet(options, "require_https", true)) != false
	if requireHTTPS && u.Scheme != "https" { return "", AxError{Category:"mcp", Message:"MCP endpoint must use https"} }
	host := u.Hostname()
	if host == "" { return "", AxError{Category:"mcp", Message:"MCP endpoint must include a host"} }
	allowLocal := coreTruthy(coreGet(options, "allowLocalhost", coreGet(options, "allow_localhost", false)))
	allowPrivate := coreTruthy(coreGet(options, "allowPrivateNetworks", coreGet(options, "allow_private_networks", false)))
	if (host == "localhost" || host == "localhost.localdomain") && !allowLocal { return "", AxError{Category:"mcp", Message:"MCP endpoint host is local"} }
	if ip, err := netip.ParseAddr(host); err == nil {
		if (ip.IsLoopback() && !allowLocal) || (ip.IsPrivate() && !allowPrivate) || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() { return "", AxError{Category:"mcp", Message:"MCP endpoint host is not allowed by SSRF protection"} }
	}
	return endpoint, nil
}

func runMCPConformanceFixture(fixture map[string]Value) {
	op := display(coreGet(fixture, "operation", "initialize"))
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	defer func() {
		if r := recover(); r != nil {
			if expectedErr != "" && strings.Contains(fmt.Sprint(r), expectedErr) { return }
			panic(r)
		}
	}()
	if op == "ssrf" {
		_, err := AxMCPValidateEndpoint(display(coreGet(fixture, "endpoint", "https://127.0.0.1/mcp")), asMap(coreGet(fixture, "ssrfProtection", Object())))
		if err != nil { panic(err) }
		if expectedErr != "" { panic("expected SSRF validation to fail") }
		return
	}
	if op == "stdio_framing" {
		msg := asMap(coreGet(fixture, "message", Object()))
		line := AxMCPStdioEncode(msg)
		if want := display(coreGet(fixture, "expected_line", "")); want != "" && line != want { panic("stdio line mismatch") }
		decoded, err := AxMCPStdioDecode(line); if err != nil { panic(err) }
		assertSubset(decoded, msg, "stdio decoded")
		return
	}
	if op == "oauth" {
		challenge := AxMCPPKCEChallenge(display(coreGet(fixture, "verifier", "test-verifier")))
		if want := display(coreGet(fixture, "expected_challenge", "")); want != "" && challenge != want { panic("PKCE challenge mismatch") }
		store := &mcpMapTokenStore{tokens:map[string]AxMCPTokenSet{}}
		t, err := NewAxMCPStreamableHTTPTransport(display(coreGet(fixture, "endpoint", "https://example.com/mcp")), nil); if err != nil { panic(err) }
		t.OAuth = &AxMCPOAuthOptions{TokenStore:store, OnAuthCode:func(string)(map[string]string,error){ return map[string]string{"code":"abc"}, nil }}
		if !t.ApplyOAuth() { panic("OAuth flow did not produce a token") }
		if t.Headers["Authorization"] == "" { panic("OAuth flow did not set Authorization") }
		return
	}
	if op == "http_session_headers" {
		t, err := NewAxMCPStreamableHTTPTransport(display(coreGet(fixture, "endpoint", "https://example.com/mcp")), asMap(coreGet(fixture, "transport_options", Object()))); if err != nil { panic(err) }
		t.SessionID = display(coreGet(fixture, "session_id", "session-1"))
		t.SetProtocolVersion(display(coreGet(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)))
		assertSubset(mcpHeaderValues(t.BuildHeaders(map[string]string{"Accept":"application/json"}, true)), coreGet(fixture, "expected_headers", Object()), "headers")
		return
	}
	if op == "execution_context_ucp" {
		transport:=NewAxMCPScriptedTransport(asSlice(coreGet(fixture,"responses",Array())))
		mcp:=NewAxMCPClient(transport,asMap(coreGet(fixture,"client_options",Object())))
		ucp,err:=NewAxUCPClient(asMap(coreGet(fixture,"ucp_profile",Object())),AxUCPBindingFunc(func(string,map[string]Value,map[string]Value)(map[string]Value,error){return asMap(coreGet(fixture,"ucp_response",Object())),nil}),asMap(coreGet(fixture,"ucp_options",Object())));if err!=nil{panic(err)}
		context,err:=NewAxExecutionContext([]*AxMCPClient{mcp},[]*AxUCPClient{ucp});if err!=nil{panic(err)};if err=context.Initialize();err!=nil{panic(err)}
		expected:=asSlice(coreGet(fixture,"expected_namespaces",Array()));actual:=[]Value{};for _,name:=range context.Namespaces(){actual=append(actual,name)};assertEqual(actual,expected,"context namespaces")
		tools,err:=context.NativeTools();if err!=nil{panic(err)};names:=map[string]bool{};for _,tool:=range tools{names[tool.Name]=true};for _,raw:=range asSlice(coreGet(fixture,"expected_native_tools",Array())){if !names[display(raw)]{panic("missing native context tool "+display(raw))}}
		call:=asMap(coreGet(fixture,"call_ucp",Object()));outcome,err:=ucp.Call(display(coreGet(call,"operation","catalog.search")),asMap(coreGet(call,"payload",Object())),"fixture-key");if err!=nil{panic(err)};assertSubset(outcome,coreGet(fixture,"expected_ucp_outcome",Object()),"UCP outcome")
		state:=context.ContinuationState();if state.CatalogFingerprint==""||len(state.Namespaces)!=len(actual){panic("invalid execution context continuation state")};return
	}
	transport := NewAxMCPScriptedTransport(asSlice(coreGet(fixture, "responses", coreGet(fixture, "transport_responses", Array()))))
	client := NewAxMCPClient(transport, asMap(coreGet(fixture, "client_options", Object())))
	if err := client.Init(); err != nil { panic(err) }
	if want := display(coreGet(fixture, "expected_protocol_version", "")); want != "" && client.ProtocolVersion() != want { panic("protocol version mismatch") }
	switch op {
	case "initialize", "protocol_negotiation":
		assertMCPRequests(transport.Requests, fixture)
	case "ping":
		if _, err := client.Ping(); err != nil { panic(err) }
		assertMCPRequests(transport.Requests, fixture)
	case "tools":
		functions := client.NativeTools()
		var names []Value
		for _, fn := range functions { names = append(names, fn.Name) }
		if expected := coreGet(fixture, "expected_function_names", nil); expected != nil { assertEqual(names, expected, "function names") }
		if call := coreGet(fixture, "call_function", nil); call != nil {
			c := asMap(call)
			var found *Tool
			for i := range functions { if functions[i].Name == display(coreGet(c, "name", "")) { found = &functions[i] } }
			if found == nil { panic("missing function") }
			result := found.Call(asMap(coreGet(c, "arguments", Object())))
			assertSubset(result, coreGet(fixture, "expected_call_result", Object()), "tool result")
		}
		assertMCPRequests(transport.Requests, fixture)
	case "prompts_resources":
		assertMCPCatalogNames(client.Prompts(), coreGet(fixture, "expected_prompt_names", nil), "prompt names")
		assertMCPCatalogNames(client.Resources(), coreGet(fixture, "expected_resource_names", nil), "resource names")
		assertMCPCatalogNames(client.ResourceTemplates(), coreGet(fixture, "expected_resource_template_names", nil), "resource template names")
	case "roots_notifications":
		transport.Emit(map[string]Value{"jsonrpc":"2.0", "id":"server-1", "method":"roots/list"})
		assertSubset(transport.SentResponses[0], coreGet(fixture, "expected_roots_response", Object()), "roots response")
	case "cancellation":
		if err := client.CancelRequest(coreGet(fixture, "request_id", "1"), display(coreGet(fixture, "reason", "cancelled"))); err != nil { panic(err) }
		assertSubset(transport.Notifications[len(transport.Notifications)-1], coreGet(fixture, "expected_notification", Object()), "cancel notification")
	default:
		panic("unsupported MCP conformance operation "+op)
	}
}

func assertMCPCatalogNames(catalog []map[string]Value, expected Value, label string) {
	if expected == nil { return }
	names := []Value{}
	for _, item := range catalog { names = append(names, display(coreGet(item, "name", ""))) }
	assertEqual(names, expected, label)
}

func assertMCPRequests(requests []map[string]Value, fixture map[string]Value) {
	expected := asSlice(coreGet(fixture, "expected_requests", Array()))
	if len(requests) < len(expected) { panic("not enough MCP requests") }
	for i, want := range expected { assertSubset(requests[i], want, fmt.Sprintf("request %d", i)) }
}

type mcpMapTokenStore struct { tokens map[string]AxMCPTokenSet }
func (s *mcpMapTokenStore) GetToken(key string) (*AxMCPTokenSet, error) { if token, ok := s.tokens[key]; ok { return &token, nil }; return nil, nil }
func (s *mcpMapTokenStore) SetToken(key string, token AxMCPTokenSet) error { s.tokens[key] = token; return nil }
func (s *mcpMapTokenStore) ClearToken(key string) error { delete(s.tokens, key); return nil }

func cursorParams(cursor string) map[string]Value { if cursor == "" { return map[string]Value{} }; return map[string]Value{"cursor":cursor} }
func stringIn(items []string, want string) bool { for _, item := range items { if item == want { return true } }; return false }
func stringList(value Value) []string { var out []string; for _, item := range asSlice(value) { out = append(out, display(item)) }; if len(out)==0 { return AX_MCP_SUPPORTED_PROTOCOL_VERSIONS }; return out }
func mcpHeaderValues(headers map[string]string) map[string]Value { out := map[string]Value{}; for key, value := range headers { out[key] = value }; return out }
func contentText(items []Value) string { var out []string; for _, item := range items { m := asMap(item); if display(coreGet(m, "type", "")) == "text" { out = append(out, display(coreGet(m, "text", ""))) } }; return strings.Join(out, "\n") }
func safeMCPName(value string) string { var b strings.Builder; last := false; for _, r := range value { ok := (r>='a'&&r<='z')||(r>='A'&&r<='Z')||(r>='0'&&r<='9'); if ok { b.WriteRune(r); last=false } else if !last { b.WriteByte('_'); last=true } }; return strings.Trim(b.String(), "_") }
func cloneMCPMap(value map[string]Value) map[string]Value { data, _ := json.Marshal(value); var out map[string]Value; _ = json.Unmarshal(data, &out); return out }
