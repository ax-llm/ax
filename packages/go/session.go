package axllm

import (
	"context"
	"fmt"
	"io"
	"iter"
	"strings"
	"sync"
	"time"
)

// AxRunControl can be shared by the root program and its descendants. Updates
// are retained so that scopes which start later observe the same root updates.
type AxRunControl struct {
    parent *AxRunControl
    relay func(map[string]Value)
	mu        sync.Mutex
	updates   []map[string]Value
	listeners []func(map[string]Value)
	done      chan struct{}
	once      sync.Once
}

func RunControl() *AxRunControl { return &AxRunControl{done: make(chan struct{})} }
func (c *AxRunControl) Abort() {
	c.once.Do(func() { close(c.done); c.emit(Object("type", "aborted", "path", "root")) })
}
func (c *AxRunControl) Done() <-chan struct{} { return c.done }
func (c *AxRunControl) OnEvent(listener func(map[string]Value)) {
	c.mu.Lock()
	c.listeners = append(c.listeners, listener)
	c.mu.Unlock()
}
func (c *AxRunControl) emit(event map[string]Value) {
    if c.relay != nil { c.relay(cloneMap(event)); return }
	c.mu.Lock()
	listeners := append([]func(map[string]Value){}, c.listeners...)
	c.mu.Unlock()
	for _, listener := range listeners {
		listener(cloneMap(event))
	}
}
func (c *AxRunControl) enqueue(update map[string]Value, target []string) error {
	select {
	case <-c.done:
		return fmt.Errorf("run controller is aborted")
	default:
	}
	path := "root"
	if len(target) > 0 {
		path = target[0]
	}
	c.mu.Lock()
	id := fmt.Sprint(len(c.updates) + 1)
	coreSet(update, "id", id)
	coreSet(update, "target", path)
	c.updates = append(c.updates, update)
	c.mu.Unlock()
	c.emit(Object("type", "queued", "path", path, "update_id", id))
	return nil
}
func (c *AxRunControl) Steer(text string, target ...string) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("steering text must not be empty")
	}
	return c.enqueue(Object("type", "steer", "text", text), target)
}
func (c *AxRunControl) SetThinkingTokenBudget(level string, target ...string) error {
	switch level {
	case "none", "minimal", "low", "medium", "high", "highest":
	default:
		return fmt.Errorf("invalid thinking token budget %q", level)
	}
	return c.enqueue(Object("type", "thinking", "level", level), target)
}
func (c *AxRunControl) pending(path string, after int) ([]map[string]Value, int) {
    if c.parent != nil {return c.parent.pending(path,after)}
	c.mu.Lock()
	defer c.mu.Unlock()
	updates := []map[string]Value{}
	for _, update := range c.updates[after:] {
		if coreTruthy(mustCore(chat_session_target_matches(coreGet(update, "target", "root"), path))) {
			updates = append(updates, cloneMap(update))
		}
	}
	return updates, len(c.updates)
}

// AxChatSession is an optional normalized AI capability. Chat-only services do
// not need to implement it. Session ownership stays with the generation run.
type AxChatSession interface {
	Next(context.Context) (Value, error)
	Submit([]Value) error
	Update(map[string]Value) (string, error)
	Close() error
}
type SessionAIClient interface {
	OpenChatSession(context.Context, map[string]Value, map[string]Value) (AxChatSession, error)
}

// AxSessionWebSocketFactory reuses the host transport with configured endpoint and credentials.
type AxSessionWebSocketFactory func(context.Context, string, map[string]Value) (RealtimeTransport, error)

type sessionDelivery struct {
	event Value
	err   error
}
type responsesChatSession struct {
	client           *OpenAICompatibleClient
	ctx              context.Context
	cancel           context.CancelFunc
	request, options map[string]Value
	model            string
	previous         string
	updates          []Value
	wire             Value
	deliveries       chan sessionDelivery
	mu               sync.Mutex
	stream           rawProviderStream
	socket           RealtimeTransport
	socketMu         sync.Mutex
	active           bool
	lastWasUpdate    bool
	once             sync.Once
}

func (c *OpenAICompatibleClient) OpenChatSession(ctx context.Context, request, options map[string]Value) (AxChatSession, error) {
	request, options = c.resolveModelKey(request, options, false)
	returnSession, err := safeValue(func() Value {
		opts := mergeAIOptions(c.optionsSnapshot(), options)
		req := cloneMap(request)
		model := display(coreGet(req, "model", coreGet(opts, "model", "")))
		if !coreTruthy(coreGet(req, "model", nil)) {
			model = display(coreGet(opts, "model", ""))
		}
		if (c.Profile != "openai" && c.Profile != "openai-responses") || !strings.HasPrefix(model, "gpt-6-astra") {
			panic(fmt.Errorf("model does not support chat sessions"))
		}
		config := mustCore(merge_model_config(coreGet(opts, "model_config", Object()), coreGet(req, "model_config", Object()), opts))
		coreSet(config, "stream", true)
		coreSet(req, "model_config", config)
		coreSet(req, "model", model)
		coreSet(req, "session_enabled", true)
		runCtx, cancel := context.WithCancel(ctx)
		s := &responsesChatSession{client: c, ctx: runCtx, cancel: cancel, request: req, options: opts, model: model, wire: Object(), deliveries: make(chan sessionDelivery, 32)}
		if socket, ok := coreGet(opts, "webSocketTransport", coreGet(opts, "web_socket_transport", nil)).(RealtimeTransport); ok {
			s.socket = socket
		}
		if factory, ok := coreGet(opts, "webSocketFactory", coreGet(opts, "web_socket_factory", nil)).(AxSessionWebSocketFactory); ok {
			call := c.requestJSON(runCtx, "stream_chat", req, true, opts)
			target := display(coreGet(call, "url", ""))
			target = strings.Replace(strings.Replace(target, "https://", "wss://", 1), "http://", "ws://", 1)
			socket, err := factory(runCtx, target, asMap(coreGet(call, "headers", Object())))
			if err != nil {
				cancel()
				panic(err)
			}
			if socket == nil {
                cancel()
                panic(fmt.Errorf("Session WebSocket factory returned no transport"))
            }
			s.socket = socket
		}
		if s.socket != nil {
			go s.readSocket()
		}
		s.send(nil, false)
		return s
	})
	if err != nil {
		return nil, err
	}
	return returnSession.(AxChatSession), nil
}
func (s *responsesChatSession) deliver(event Value, err error) {
	select {
	case s.deliveries <- sessionDelivery{event, err}:
	case <-s.ctx.Done():
	}
}
func (s *responsesChatSession) accept(raw Value) {
	s.mu.Lock()
	if coreGet(raw, "type", "") == "response.created" {
		s.previous = display(coreGet(coreGet(raw, "response", Object()), "id", ""))
		s.active = true
	}
	events, err := openai_responses_session_event(raw, s.wire, s.model)
	for _, event := range asSlice(events) {
		if coreGet(event, "type", "") == "response.completed" {
			s.active = false
			s.previous = display(coreGet(event, "response_id", ""))
		}
	}
	s.mu.Unlock()
	if err != nil {
		panic(err)
	}
	for _, event := range asSlice(events) {
		s.deliver(event, nil)
	}
}
func (s *responsesChatSession) readSocket() {
	_, err := safeValue(func() Value {
		for s.ctx.Err() == nil {
			raw, ok := s.socket.Recv()
			if !ok {
				panic(fmt.Errorf("Responses socket disconnected; work was not replayed"))
			}
			s.accept(raw)
		}
		return nil
	})
	if err != nil {
		s.deliver(nil, err)
	}
}
func (s *responsesChatSession) socketSend(event Value) {
	s.socketMu.Lock()
	defer s.socketMu.Unlock()
	s.socket.Send(event)
}
func (s *responsesChatSession) send(items []Value, continuation bool) {
	req := cloneMap(s.request)
	if continuation {
		s.mu.Lock()
		previous := s.previous
		s.mu.Unlock()
		coreSet(req, "previous_response_id", previous)
		coreSet(req, "session_input", append(append([]Value{}, s.updates...), items...))
		s.updates = nil
	}
	call := s.client.requestJSON(s.ctx, "stream_chat", req, true, s.options)
	payload := asMap(coreGet(call, "json", Object()))
	mustCore(openai_responses_validate_session_request(payload))
	input := asSlice(coreGet(payload, "input", Array()))
	if s.lastWasUpdate && len(input) > 0 && coreGet(input[0], "type", "") == "configuration_update" {
		panic(fmt.Errorf("adjacent configuration_update items are not supported across responses"))
	}
	s.lastWasUpdate = len(input) > 0 && coreGet(input[len(input)-1], "type", "") == "configuration_update"
	s.mu.Lock()
	s.active = true
	s.mu.Unlock()
	if s.socket != nil {
		delete(payload, "stream")
		coreSet(payload, "type", "response.create")
		s.socketSend(payload)
		return
	}
	go func() {
		_, err := safeValue(func() Value {
			stream, err := s.client.openProviderStream(s.ctx, call, s.options)
			if err != nil {
				panic(err)
			}
			s.mu.Lock()
			s.stream = stream
			s.mu.Unlock()
			defer stream.Close()
			complete := false
			for {
				if s.ctx.Err() != nil {
					return nil
				}
				raw, err := stream.Next()
				if err == io.EOF {
					break
				}
				if err != nil {
					panic(err)
				}
				// The stream worker owns only wire normalization. The run's
				// dispatcher is the sole owner of conversation and tool state.
				s.mu.Lock()
				events, normalizeErr := openai_responses_session_event(raw, s.wire, s.model)
				s.mu.Unlock()
				if normalizeErr != nil {
					panic(normalizeErr)
				}
				for _, event := range asSlice(events) {
					if coreGet(event, "type", "") == "response.completed" {
						complete = true
					}
					s.deliver(event, nil)
				}
				if complete {
					break
				}
			}
			if !complete && s.ctx.Err() == nil {
				panic(fmt.Errorf("Responses stream disconnected before completion; work was not replayed"))
			}
			return nil
		})
		if err != nil {
			s.deliver(nil, err)
		}
	}()
}
func (s *responsesChatSession) Next(ctx context.Context) (Value, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	case delivery := <-s.deliveries:
		if delivery.err != nil {
			return nil, delivery.err
		}
		if coreGet(delivery.event, "type", "") == "response.completed" {
			if s.socket == nil {
				s.mu.Lock()
				s.previous = display(coreGet(delivery.event, "response_id", ""))
				s.active = false
				s.mu.Unlock()
			}
			response := coreGet(delivery.event, "response", Object())
			s.client.setLastUsage(coreGet(response, "model_usage", nil))
			emitUsageEvent("chat", response, s.options, true)
		}
		return delivery.event, nil
	}
}
func (s *responsesChatSession) Submit(results []Value) error {
	items := []Value{}
	for _, result := range results {
		items = append(items, Object("type", "function_call_output", "call_id", coreGet(result, "function_id", ""), "output", coreGet(result, "result", "")))
	}
	s.send(items, true)
	return nil
}
func (s *responsesChatSession) Update(update map[string]Value) (string, error) {
	if coreGet(update, "type", "") == "steer" {
		s.mu.Lock()
		active, previous := s.active, s.previous
		s.mu.Unlock()
		if s.socket != nil && active && previous != "" {
			s.socketSend(Object("type", "response.steer", "previous_response_id", previous, "input", Array(Object("role", "user", "content", Array(Object("type", "input_text", "text", coreGet(update, "text", "")))))))
			return "native", nil
		}
		s.updates = append(s.updates, Object("role", "user", "content", Array(Object("type", "input_text", "text", coreGet(update, "text", "")))))
	} else {
		effort, err := openai_reasoning_effort(s.model, coreGet(update, "level", "low"))
		if err != nil {
			return "", err
		}
		if len(s.updates) > 0 && coreGet(s.updates[len(s.updates)-1], "type", "") == "configuration_update" {
			return "", fmt.Errorf("adjacent configuration_update items are not supported")
		}
		s.updates = append(s.updates, Object("type", "configuration_update", "reasoning", Object("effort", effort)))
	}
	return "next-response", nil
}
func (s *responsesChatSession) Close() error {
	s.once.Do(func() {
		s.cancel()
		if s.socket != nil {
			s.socket.Close()
		}
		s.mu.Lock()
		stream := s.stream
		s.mu.Unlock()
		if stream != nil {
			_ = stream.Close()
		}
	})
	return nil
}

type sessionToolResult struct {
	call   Value
	result Value
	err    error
}
type chatRunSelector interface {
    pinChatRun(context.Context,map[string]Value,map[string]Value)(AIClient,error)
}

// genSessionClient is a run's client: it pins the run's provider on the first
// request and then either applies the run control's updates at each request
// boundary, or, for a client with native chat sessions, runs each model
// request in its own session, as TypeScript's axRunChatSession does.
type genSessionClient struct {
	selected bool
	level    Value
	// started says the run has reported its start, which it does once,
	// before its first request goes out.
	started bool
	AIClient
	gen     *AxGen
	opener  SessionAIClient
	options map[string]Value
	control *AxRunControl
	path    string
	// One request's native session (see resetSession): the session, its
	// state, its last completed response, its events and its tool workers'
	// results, the context that cancels it, and the run updates it has
	// applied. after is also the request boundary's update cursor.
	session    AxChatSession
	state      Value
	last       Value
	ctx        context.Context
	cancel     context.CancelFunc
	deliveries chan sessionDelivery
	results    chan sessionToolResult
	blocking   bool
	waiting    []Value
	after      int
	applied    []string
	// stopStream stops the session stream a streamed request left open.
	stopStream func()
}

// sessionItem is what one request's native session yields: a partial
// response event, the ID of a response the session continues from
// ("completed"), or the final response.
type sessionItem struct {
	kind  string
	value Value
}

func (p *genSessionClient) GetFeatures(model string) map[string]Value {
	if c, ok := p.AIClient.(interface{ GetFeatures(string) map[string]Value }); ok {
		return c.GetFeatures(model)
	}
	return Object("functions", true, "structured_outputs", true)
}

// Speak passes the audio output renderer's speech request to the client the
// session wraps.
func (p *genSessionClient) Speak(ctx context.Context, request, options map[string]Value) (Value, error) {
	return speakWithClient(p.AIClient, ctx, request, options)
}
func (p *genSessionClient) emit(kind string, fields ...Value) {
	if p.control != nil {
		p.control.emit(Object(append([]Value{"type", kind, "path", p.path}, fields...)...))
	}
}

// emitStarted reports the run's start once, before its first request goes
// out.
func (p *genSessionClient) emitStarted() {
	if !p.started {
		p.started = true
		p.emit("started")
	}
}
func (p *genSessionClient) start(call Value) {
	call = mustCore(chat_session_normalize_call(call))
	if coreGet(coreGet(call, "function", Object()), "name", "") == "__axOutput" {
		mustCore(chat_session_defer_final_call(p.state, call))
		return
	}
	pending := coreGet(p.state, "pending", Object())
	id := display(coreGet(call, "id", ""))
	if _, exists := asMap(pending)[id]; exists {
		return
	}
	if p.blocking {
		p.waiting = append(p.waiting, call)
		return
	}
	var selected *Tool
	name := display(coreGet(coreGet(call, "function", Object()), "name", ""))
	for i := range p.gen.Functions {
		if p.gen.Functions[i].Name == name {
			tool := p.gen.Functions[i]
			selected = &tool
			break
		}
	}
	args := coreGet(coreGet(call, "function", Object()), "params", Object())
	var validationErr error
	if text, ok := args.(string); ok {
		args, validationErr = parseJSONErr(text)
	}
	if selected == nil {
		validationErr = fmt.Errorf("function %q not found", name)
	} else if validationErr == nil {
		_, validationErr = validate_fields(toolFields(selected.Args), args, "tool."+name+".args")
        if validationErr == nil { _, validationErr = chat_session_validate_required_arguments(selected.Schema(), args, "tool."+name+".args") }
	}
	execution := "blocking"
	if selected != nil && selected.ExecutionMode == "background" {
		execution = "background"
	}
	mustCore(chat_session_register_call(p.state, call, execution))
	if validationErr != nil {
		message := mustCore(_tool_error_message_impl(call, validationErr))
		mustCore(chat_session_record_result(p.gen, p.state, call, coreGet(message, "result", validationErr.Error()), false))
		return
	}
	p.blocking = execution == "blocking"
	p.emit("tool.started", "call_id", id)
	tool := *selected
	ownedArgs := cloneMap(asMap(args))
	ownedCall := cloneValue(call)
	// The worker's result goes to the session that started it, never to a
	// later request's session, and closing that session cancels it.
	ctx, results := p.ctx, p.results
	go func() {
		result, err := safeValue(func() Value {
			return mustCore(tool.invokeContext(ctx, ownedArgs))
		})
		select {
		case results <- sessionToolResult{ownedCall, result, err}:
		case <-ctx.Done():
		}
	}()
}
// pinRun resolves the run's client on its first request.
func (p *genSessionClient) pinRun(ctx context.Context, request map[string]Value) {
	if p.selected {
		return
	}
	current := p.AIClient
	for {
		bound, ok := current.(contextBoundAIClient)
		if !ok {
			break
		}
		current = bound.inner
	}
	seen := map[AIClient]bool{}
	for {
		selector, ok := current.(chatRunSelector)
		if !ok {
			break
		}
		if seen[current] {
			panic(fmt.Errorf("cyclic run routing"))
		}
		seen[current] = true
		current = mustCore(selector.pinChatRun(ctx, request, p.options)).(AIClient)
	}
	p.AIClient = current
	p.selected = true
	p.opener = nil
	if coreTruthy(mustCore(chat_session_mode_enabled(p.options))) {
		if service, ok := current.(interface{ GetFeatures(string) map[string]Value }); ok && coreTruthy(coreGet(service.GetFeatures(display(coreGet(request, "model", ""))), "asyncTools", false)) {
			p.opener, _ = current.(SessionAIClient)
		}
	}
}

// boundaryRequest applies the run's pending updates to a request made
// without a chat session.
func (p *genSessionClient) boundaryRequest(request map[string]Value) map[string]Value {
	p.emitStarted()
	var updates []map[string]Value
	if p.control != nil {
		select {
		case <-p.control.Done():
			panic(fmt.Errorf("run aborted before the next model request"))
		default:
		}
		updates, p.after = p.control.pending(p.path, p.after)
	}
	items := Array()
	for _, update := range updates {
		items = append(items, update)
	}
	applied := mustCore(chat_session_apply_boundary_updates(request, items, p.level))
	p.level = coreGet(applied, "level", nil)
	for _, id := range asSlice(coreGet(applied, "applied", Array())) {
		p.emit("applied", "update_id", id, "timing", "next-response")
	}
	return asMap(coreGet(applied, "request", request))
}

// StreamEvents lets a streamed request through the run boundary: without a
// chat session it applies the pending updates as Chat does and streams from
// the run's client; with one, the request runs in its own native session and
// streams the session's items as they happen (see sessionStream).
func (p *genSessionClient) StreamEvents(ctx context.Context, request, options map[string]Value) (AxChatStream, error) {
	prepared, err := safeValue(func() Value {
		p.pinRun(ctx, request)
		if p.opener != nil {
			return nil
		}
		return p.boundaryRequest(request)
	})
	if err != nil {
		return nil, err
	}
	if p.opener != nil {
		return p.sessionStream(ctx, request, options), nil
	}
	return openAIClientStream(ctx, p.AIClient, asMap(prepared), options)
}

// Chat answers a request: without a chat session through the run boundary,
// with one in the request's own native session, whose final response it
// returns.
func (p *genSessionClient) Chat(ctx context.Context, request, options map[string]Value) (Value, error) {
	return safeValue(func() Value {
		p.pinRun(ctx, request)
		if p.opener == nil {
			return mustCore(p.AIClient.Chat(ctx, p.boundaryRequest(request), options))
		}
		var final Value
		p.runSession(ctx, request, options, func(item sessionItem) bool {
			if item.kind != "final" {
				return true
			}
			final = item.value
			return false
		})
		if final == nil {
			panic(fmt.Errorf("chat session ended without a response"))
		}
		return final
	})
}

// sessionStream streams one request's native session for the streaming
// forward. The session runs while the forward waits for its next item and
// hands each one over as it happens: a partial response event with its
// results, a response the session continues from, and the final response.
// Closing the stream closes the session.
func (p *genSessionClient) sessionStream(ctx context.Context, request, options map[string]Value) AxChatStream {
	var failure error
	next, stop := iter.Pull(func(yield func(Value) bool) {
		_, failure = safeValue(func() Value {
			p.runSession(ctx, request, options, func(item sessionItem) bool {
				return yield(p.sessionStreamValue(item))
			})
			return nil
		})
	})
	p.stopStream = stop
	return newAxChatStream(func() (Value, error) {
		if value, ok := next(); ok {
			return value, nil
		}
		if failure != nil {
			return nil, failure
		}
		return nil, io.EOF
	}, func() error {
		stop()
		return nil
	}, nil)
}

// sessionStreamValue is the stream chunk of a session item: its "session"
// key tells the streaming forward what the item is, the response it belongs
// to and the session's turns so far.
func (p *genSessionClient) sessionStreamValue(item sessionItem) Value {
	turns := coreGet(p.state, "turns", Array())
	switch item.kind {
	case "partial":
		started := false
		for id := range asMap(coreGet(p.state, "pending", Object())) {
			if id != "__order" {
				started = true
				break
			}
		}
		info := Object("type", "partial", "response_id", coreGet(item.value, "response_id", ""), "calls_started", started, "pending_calls", mustCore(chat_session_unresolved(p.state)), "turns", turns)
		return Object("session", info, "results", coreGet(coreGet(item.value, "response", Object()), "results", Array()))
	case "completed":
		return Object("session", Object("type", "completed", "response_id", item.value, "turns", turns))
	}
	// The final response, as the chat answers it, without the session's
	// own keys.
	response := asMap(item.value)
	final := Object()
	for _, key := range orderedKeys(response) {
		if key != "__order" && !strings.HasPrefix(key, "__session") {
			coreSet(final, key, response[key])
		}
	}
	coreSet(final, "session", Object("type", "final", "response_id", coreGet(p.state, "response_id", nil), "turns", turns))
	return final
}

// resetSession starts the state of one request's native session: its
// events, its tool workers' results and the context that cancels them, and
// its update cursor, back at the start, so each session applies all of the
// run's updates again.
func (p *genSessionClient) resetSession(ctx context.Context) {
	p.ctx, p.cancel = context.WithCancel(ctx)
	p.deliveries = make(chan sessionDelivery, 32)
	p.results = make(chan sessionToolResult, 32)
	p.session = nil
	p.state = nil
	p.last = nil
	p.blocking = false
	p.waiting = nil
	p.after = 0
	p.applied = nil
}

// closeSession cancels the open session's context, which also stops its
// tool workers, and closes the session.
func (p *genSessionClient) closeSession() {
	if p.cancel != nil {
		p.cancel()
	}
	if session := p.session; session != nil {
		p.session = nil
		_ = session.Close()
	}
}

// runSession runs one model request in its own native session, as
// TypeScript's axRunChatSession does: the session opens with the request's
// whole prompt, applies the run's updates for its path, runs its tool loop,
// and closes once the request's response completes. It yields each partial
// response event, the ID of each response the session continues from, and
// then the final response; yield returning false stops it. It panics on
// failure; the session is closed either way.
func (p *genSessionClient) runSession(ctx context.Context, request, options map[string]Value, yield func(sessionItem) bool) {
	p.emitStarted()
	if p.control != nil {
		select {
		case <-p.control.Done():
			panic(fmt.Errorf("run aborted before opening a session"))
		default:
		}
	}
	p.resetSession(ctx)
	defer p.closeSession()
	session, err := p.opener.OpenChatSession(p.ctx, request, mergeAIOptions(p.options, options))
	if err != nil {
		panic(err)
	}
	p.session = session
	p.state = mustCore(chat_session_create_state(coreGet(request, "model", ""), p.path, coreGet(p.options, "maxSteps", coreGet(p.options, "max_steps", 10))))
	sessionCtx, deliveries, results := p.ctx, p.deliveries, p.results
	go func() {
		for {
			event, err := session.Next(sessionCtx)
			select {
			case deliveries <- sessionDelivery{event, err}:
			case <-sessionCtx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var aborted <-chan struct{}
		if p.control != nil {
			aborted = p.control.Done()
			updates, after := p.control.pending(p.path, p.after)
			p.after = after
			for _, update := range updates {
				if !coreTruthy(mustCore(chat_session_queue_update(p.state, update))) {
					continue
				}
				timing, err := p.session.Update(update)
				if err != nil {
					panic(err)
				}
				if timing == "native" {
					mustCore(chat_session_native_update(p.state, coreGet(update, "id", "")))
				} else {
					p.applied = append(p.applied, display(coreGet(update, "id", "")))
				}
			}
		}
		select {
		case <-ctx.Done():
			panic(fmt.Errorf("run aborted; unresolved calls: %v: %w", mustCore(chat_session_unresolved(p.state)), ctx.Err()))
		case <-aborted:
			panic(fmt.Errorf("run aborted; unresolved calls: %v", mustCore(chat_session_unresolved(p.state))))
		case <-ticker.C:
		case result := <-results:
			id := display(coreGet(result.call, "id", ""))
			value := result.result
			if result.err != nil {
				value = coreGet(mustCore(_tool_error_message_impl(result.call, result.err)), "result", result.err.Error())
			}
			if !coreTruthy(mustCore(chat_session_record_result(p.gen, p.state, result.call, value, result.err == nil))) {
				continue
			}
			p.emit("tool.completed", "call_id", id)
			record := coreGet(coreGet(p.state, "pending", Object()), id, Object())
			if coreGet(record, "execution", "") == "blocking" {
				p.blocking = false
				queued := p.waiting
				p.waiting = nil
				for _, call := range queued {
					p.start(call)
				}
			}
		case delivery := <-deliveries:
			if delivery.err != nil {
				panic(fmt.Errorf("session failed; unresolved calls: %v: %w", mustCore(chat_session_unresolved(p.state)), delivery.err))
			}
			event := delivery.event
			switch coreGet(event, "type", "") {
			case "response":
				output := mustCore(chat_session_observe_output(p.gen, p.state, event))
				p.emit("model.output", "response_id", coreGet(output, "response_id", nil), "text", coreGet(output, "text", ""), "version", coreGet(output, "version", 0))
				if !yield(sessionItem{"partial", event}) {
					return
				}
			case "steering":
				result := mustCore(chat_session_native_event(p.state, event))
				if id := coreGet(result, "applied_id", nil); id != nil {
					p.emit("applied", "update_id", id, "timing", "native")
				}
			case "tool.call":
				p.start(coreGet(event, "call", Object()))
			case "response.completed":
				id := coreGet(event, "response_id", "")
				if coreTruthy(mustCore(chat_session_complete_response(p.state, id))) {
					p.last = coreGet(event, "response", Object())
					completion := mustCore(chat_session_completion(p.last, id))
					for _, call := range asSlice(mustCore(_response_function_calls_impl(completion))) {
						p.start(call)
					}
					// A response the session continues from joins memory,
					// the chat log and the session's turns.
					if coreTruthy(mustCore(chat_session_has_continuation_work(p.state))) {
						mustCore(chat_session_record_response(p.gen, p.state, request, completion))
					}
					if !yield(sessionItem{"completed", id}) {
						return
					}
				}
			}
		}
		action := mustCore(chat_session_boundary_action(p.state))
		switch coreGet(action, "type", "") {
		case "submit":
			p.submit(asSlice(coreGet(action, "results", Array())))
		case "continue":
			p.submit(nil)
		case "validate":
			if p.last != nil {
				yield(sessionItem{"final", mustCore(chat_session_final_result(p.state, p.last))})
				return
			}
		}
	}
}
func (p *genSessionClient) submit(results []Value) {
	if num(coreGet(p.state, "steps", 0)) >= num(coreGet(p.state, "max_steps", 10)) {
		panic(fmt.Errorf("maximum model steps exhausted before final completion"))
	}
	if err := p.session.Submit(results); err != nil {
		panic(err)
	}
	ids := Array()
	for _, result := range results {
		ids = append(ids, coreGet(result, "function_id", ""))
	}
	mustCore(chat_session_mark_submitted(p.state, ids))
	for _, id := range p.applied {
		mustCore(chat_session_transition(p.state, Object("type", "update.applied", "id", id)))
		p.emit("applied", "update_id", id, "timing", "next-response")
	}
	p.applied = nil
}
func (p *genSessionClient) close(err error) {
	p.finish(err, false)
}

// finish ends the run. It stops a session stream left open and closes a
// session still open after an error, and records the last session's
// unresolved calls. A run the consumer stopped early ends with an aborted
// event rather than failed; any other run as failed or completed.
func (p *genSessionClient) finish(err error, consumerStopped bool) {
	if p.stopStream != nil {
		p.stopStream()
	}
	p.closeSession()
	pending := Value(Array())
	if p.state != nil {
        mustCore(chat_session_record_unresolved(p.gen,p.state))
		pending = mustCore(chat_session_close_state(p.state))
	}
	switch {
	case consumerStopped:
		p.emit("aborted")
	case err != nil:
		p.emit("failed", "error", err.Error(), "pending_call_ids", pending)
	default:
		p.emit("completed")
	}
}

// controlBoundary returns the run control's request boundary behind client:
// the run client that applies a control's pending updates at each request.
// It is nil without a control, and for a native chat session, which applies
// its controls itself.
func controlBoundary(client Value) *genSessionClient {
	for {
		bound, ok := client.(contextBoundAIClient)
		if !ok {
			break
		}
		client = bound.inner
	}
	p, ok := client.(*genSessionClient)
	if !ok || p == nil || p.control == nil || p.opener != nil {
		return nil
	}
	return p
}

// takeControlUpdates hands the updates queued for the run's path to the
// forward, which applies them when a step starts, as TypeScript does: they
// count as applied now, and the next request boundary skips them.
func (p *genSessionClient) takeControlUpdates() []map[string]Value {
	updates, after := p.control.pending(p.path, p.after)
	p.after = after
	if len(updates) > 0 {
		p.emitStarted()
	}
	for _, update := range updates {
		p.emit("applied", "update_id", coreGet(update, "id", nil), "timing", "next-response")
	}
	return updates
}

// _core_ai_control_take_pending returns the run control updates queued for
// the run and not yet applied, which the forward applies when a step starts,
// as TypeScript does. It is empty unless client is a run control's request
// boundary (see controlBoundary).
func _core_ai_control_take_pending(client Value) Value {
	out := Array()
	if p := controlBoundary(client); p != nil {
		for _, update := range p.takeControlUpdates() {
			out = append(out, update)
		}
	}
	return out
}

// _core_ai_control_pending_count is the number of updates queued for the
// run's path that nothing has applied yet, without taking them; 0 unless
// client is a run control's request boundary.
func _core_ai_control_pending_count(client Value) Value {
	if p := controlBoundary(client); p != nil {
		updates, _ := p.control.pending(p.path, p.after)
		return float64(len(updates))
	}
	return float64(0)
}

func _core_run_control_aborted(control Value) Value {
	if c, ok := control.(*AxRunControl); ok {
		select {
		case <-c.Done():
			return true
		default:
			return false
		}
	}
	return coreTruthy(coreGet(control, "aborted", false))
}
