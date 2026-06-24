package axllm

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"os/exec"
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
	SetProtocolVersion(protocolVersion string)
	Connect() error
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
	nextID int
}

func NewAxMCPClient(transport AxMCPTransport, options map[string]Value) *AxMCPClient {
	if options == nil { options = map[string]Value{} }
	c := &AxMCPClient{transport: transport, options: options, nextID: 1}
	transport.SetMessageHandler(c.handleInboundMessage)
	return c
}

func (c *AxMCPClient) Init() error {
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
	return c.Refresh()
}

func (c *AxMCPClient) Refresh() error {
	c.tools = nil; c.prompts = nil; c.resources = nil; c.resourceTemplates = nil
	if c.capability("tools") {
		result, err := c.ListTools("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "tools", Array())) { c.tools = append(c.tools, asMap(item)) }
	}
	if c.capability("prompts") {
		result, err := c.ListPrompts("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "prompts", Array())) { c.prompts = append(c.prompts, asMap(item)) }
	}
	if c.capability("resources") {
		result, err := c.ListResources("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "resources", Array())) { c.resources = append(c.resources, asMap(item)) }
		templates, err := c.ListResourceTemplates("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(templates, "resourceTemplates", Array())) { c.resourceTemplates = append(c.resourceTemplates, asMap(item)) }
	}
	return nil
}

func (c *AxMCPClient) ProtocolVersion() string { return c.negotiatedProtocolVersion }
func (c *AxMCPClient) Tools() []map[string]Value { return append([]map[string]Value(nil), c.tools...) }
func (c *AxMCPClient) Ping() (map[string]Value, error) { return c.request("ping", map[string]Value{}) }
func (c *AxMCPClient) ListTools(cursor string) (map[string]Value, error) { return c.request("tools/list", cursorParams(cursor)) }
func (c *AxMCPClient) CallTool(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("tools/call", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListPrompts(cursor string) (map[string]Value, error) { return c.request("prompts/list", cursorParams(cursor)) }
func (c *AxMCPClient) GetPrompt(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("prompts/get", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListResources(cursor string) (map[string]Value, error) { return c.request("resources/list", cursorParams(cursor)) }
func (c *AxMCPClient) ReadResource(uri string) (map[string]Value, error) { return c.request("resources/read", map[string]Value{"uri":uri}) }
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

func (c *AxMCPClient) ToFunction() []Tool {
	var out []Tool
	for _, tool := range c.tools { out = append(out, c.toolToFunction(tool)) }
	for _, prompt := range c.prompts { out = append(out, c.promptToFunction(prompt)) }
	for _, resource := range c.resources { out = append(out, c.resourceToFunction(resource)) }
	for _, templ := range c.resourceTemplates { out = append(out, c.resourceTemplateToFunction(templ)) }
	return out
}

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
	if display(coreGet(message, "method", "")) == "roots/list" && coreGet(message, "id", nil) != nil {
		_ = c.transport.SendResponse(map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil), "result":map[string]Value{"roots":coreGet(c.options, "roots", Array())}})
	}
}

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
	client *http.Client
	OAuth *AxMCPOAuthOptions
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
func (t *AxMCPStreamableHTTPTransport) SetProtocolVersion(protocolVersion string) { t.ProtocolVersion = protocolVersion }
func (t *AxMCPStreamableHTTPTransport) Connect() error { return nil }

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
func (t *AxMCPStdioTransport) SetProtocolVersion(protocolVersion string) { t.protocolVersion = protocolVersion }
func (t *AxMCPStdioTransport) Connect() error { return nil }
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
		functions := client.ToFunction()
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
		var names []Value
		for _, fn := range client.ToFunction() { names = append(names, fn.Name) }
		if expected := coreGet(fixture, "expected_function_names", nil); expected != nil { assertEqual(names, expected, "function names") }
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
