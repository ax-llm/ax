// ax-example:start
// title: Portable Runtime Hooks
// group: generation
// description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

type logSpan struct{ name string }
func (s *logSpan) SetAttributes(map[string]ax.Value) {}
func (s *logSpan) AddEvent(name string, _ map[string]ax.Value) { fmt.Printf("[span:event] %s %s\n", s.name, name) }
func (s *logSpan) RecordException(err error) { fmt.Printf("[span:error] %s %v\n", s.name, err) }
func (s *logSpan) SetStatus(string, string) {}
func (s *logSpan) End() { fmt.Printf("[span:end] %s\n", s.name) }

type logTracer struct{}
func (logTracer) StartSpan(start ax.AxSpanStart) ax.AxSpan {
	fmt.Printf("[span:start] %s\n", start.Name)
	return &logSpan{name: start.Name}
}

type logInstrument struct{ name string }
func (i logInstrument) Add(value float64, _ map[string]ax.Value) { fmt.Printf("[metric] %s += %g\n", i.name, value) }
func (i logInstrument) Record(value float64, _ map[string]ax.Value) { fmt.Printf("[metric] %s = %g\n", i.name, value) }

type logMeter struct{}
func (logMeter) CreateCounter(name string, _ ax.AxMetricInstrumentOptions) ax.AxCounter { return logInstrument{name} }
func (logMeter) CreateHistogram(name string, _ ax.AxMetricInstrumentOptions) ax.AxHistogram { return logInstrument{name} }
func (logMeter) CreateGauge(name string, _ ax.AxMetricInstrumentOptions) ax.AxGauge { return logInstrument{name} }

func limiter(label string) ax.AxRateLimiter {
	return ax.AxRateLimiterFunc(func(next ax.AxRequestExecutor, info ax.AxRateLimitInfo) (ax.Value, error) {
		fmt.Printf("[limit:%s] %s %s/%s stream=%t\n", label, info.Operation, info.Provider, info.Model, info.Streaming)
		return next()
	})
}

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" { apiKey = os.Getenv("OPENAI_APIKEY") }
	if apiKey == "" { panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.") }
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" { model = "gpt-5.4-mini" }
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	tracer, meter := logTracer{}, logMeter{}
	override := ax.AxRuntimeHooks{RateLimiter: limiter("forward"), Tracer: tracer, Meter: meter}

	ax.SetRateLimiter(limiter("global"))
	ax.SetTracer(tracer)
	ax.SetMeter(meter)
	defer func() { ax.SetRateLimiter(nil); ax.SetTracer(nil); ax.SetMeter(nil) }()

	direct := ax.NewAx("topic:string -> summary:string", nil)
	result, err := direct.Forward(ctx, client, map[string]ax.Value{"topic": "portable Ax runtime hooks"}, nil)
	if err != nil { panic(err) }
	fmt.Println(result)

	helper := ax.NewAgent("question:string -> answer:string", nil)
	result, err = helper.ForwardWithHooks(ctx, client, map[string]ax.Value{"question": "What does a rate limiter wrap?"}, map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12}, override)
	if err != nil { panic(err) }
	fmt.Println(result)

	workflow := ax.NewFlow(map[string]ax.Value{"id": "examples.runtimeHooks"}).
		Execute("outline", ax.NewAx("topic:string -> outline:string", nil), nil).
		Execute("polish", ax.NewAx("outline:string -> answer:string", nil), nil).
		Returns(map[string]ax.Value{"answer": "polish"})
	result, err = workflow.ForwardWithHooks(ctx, client, map[string]ax.Value{"topic": "Ax runtime hooks"}, nil, override)
	if err != nil { panic(err) }
	fmt.Println(result)
}
