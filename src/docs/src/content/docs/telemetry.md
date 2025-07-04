---
title: "Telemetry Guide"
description: "Observability and monitoring for Ax applications"
---

# Telemetry Guide

**🎯 Goal**: Learn how to monitor, trace, and observe your AI applications with industry-standard OpenTelemetry integration.
**⏱️ Time to first results**: 5 minutes  
**🔍 Value**: Understand performance, debug issues, and optimize costs with comprehensive observability

## 📋 Table of Contents

- [What is Telemetry in Ax?](#what-is-telemetry-in-ax)
- [🚀 5-Minute Quick Start](#-5-minute-quick-start) ← **Start here!**
- [📊 Metrics Overview](#-metrics-overview)
- [🔍 Tracing Overview](#-tracing-overview)
- [🎯 Common Observability Patterns](#-common-observability-patterns)
- [🏗️ Production Setup](#️-production-setup)
- [⚡ Advanced Configuration](#-advanced-configuration)
- [🛠️ Troubleshooting Guide](#️-troubleshooting-guide)
- [🎓 Best Practices](#-best-practices)
- [📖 Complete Examples](#-complete-examples)
- [🎯 Key Takeaways](#-key-takeaways)

---

## What is Telemetry in Ax?

Think of telemetry as **X-ray vision for your AI applications**. Instead of guessing what's happening, you get:

- **Real-time metrics** on performance, costs, and usage
- **Distributed tracing** to follow requests through your entire AI pipeline
- **Automatic instrumentation** of all LLM operations, vector databases, and function calls
- **Industry-standard OpenTelemetry** integration for any observability platform
- **Zero-configuration** setup that works out of the box

**Real example**: A production AI system that went from "it's slow sometimes" to "we can see exactly which model calls are taking 3+ seconds and why."

### 🗺️ Learning Path
```
Beginner      → Intermediate    → Advanced       → Production
     ↓              ↓               ↓                ↓
Quick Start  → Metrics Setup   → Custom Spans    → Enterprise
(5 min)       (15 min)          (30 min)          (1+ hour)
```

---

## 🚀 5-Minute Quick Start

### Step 1: Basic Setup with Console Export

```typescript
import { AxAI, ax, f } from '@ax-llm/ax'
import { trace, metrics } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  MeterProvider,
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'

// Set up basic tracing
const tracerProvider = new BasicTracerProvider()
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
trace.setGlobalTracerProvider(tracerProvider)

// Set up basic metrics
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 5000,
    }),
  ],
})
metrics.setGlobalMeterProvider(meterProvider)

// Get your tracer and meter
const tracer = trace.getTracer('my-ai-app')
const meter = metrics.getMeter('my-ai-app')
```

### Step 2: Create AI with Telemetry

```typescript
// Create AI instance with telemetry enabled
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o-mini' },
  options: {
    tracer,
    meter,
    debug: true, // Enable detailed logging
  },
})

// Create a simple generator
const sentimentAnalyzer = ax`
  reviewText:${f.string('Customer review')} -> 
  sentiment:${f.class(['positive', 'negative', 'neutral'], 'Sentiment')}
`
```

### Step 3: Run and Observe

```typescript
// This will automatically generate traces and metrics
const result = await sentimentAnalyzer.forward(ai, {
  reviewText: 'This product is amazing! I love it!'
})

console.log('Result:', result.sentiment)
```

**�� Congratulations!** You now have full observability. Check your console for:
- **Traces**: Complete request flow with timing and metadata
- **Metrics**: Performance counters, histograms, and gauges
- **Logs**: Detailed debug information

---

## 📊 Metrics Overview

Ax automatically tracks comprehensive metrics across all operations. Here's what you get:

### 🤖 AI Service Metrics

**Request Metrics**
- `ax_llm_requests_total` - Total requests by service/model
- `ax_llm_request_duration_ms` - Request latency distribution
- `ax_llm_errors_total` - Error counts by type
- `ax_llm_error_rate` - Current error rate percentage

**Token Usage**
- `ax_llm_tokens_total` - Total tokens consumed
- `ax_llm_input_tokens_total` - Input/prompt tokens
- `ax_llm_output_tokens_total` - Output/completion tokens
- `ax_llm_thinking_budget_usage_total` - Thinking tokens used

**Cost & Performance**
- `ax_llm_estimated_cost_total` - Estimated costs in USD
- `ax_llm_request_size_bytes` - Request payload sizes
- `ax_llm_response_size_bytes` - Response payload sizes
- `ax_llm_context_window_usage_ratio` - Context window utilization

**Streaming & Functions**
- `ax_llm_streaming_requests_total` - Streaming request count
- `ax_llm_function_calls_total` - Function call counts
- `ax_llm_function_call_latency_ms` - Function call timing

### 🧠 AxGen Metrics

**Generation Flow**
- `ax_gen_generation_requests_total` - Total generation requests
- `ax_gen_generation_duration_ms` - End-to-end generation time
- `ax_gen_generation_errors_total` - Generation failures

**Multi-Step Processing**
- `ax_gen_multistep_generations_total` - Multi-step generations
- `ax_gen_steps_per_generation` - Steps taken per generation
- `ax_gen_max_steps_reached_total` - Max steps limit hits

**Error Correction**
- `ax_gen_validation_errors_total` - Validation failures
- `ax_gen_assertion_errors_total` - Assertion failures
- `ax_gen_error_correction_attempts` - Retry attempts
- `ax_gen_error_correction_success_total` - Successful corrections

**Function Integration**
- `ax_gen_functions_enabled_generations_total` - Function-enabled requests
- `ax_gen_function_call_steps_total` - Steps with function calls
- `ax_gen_functions_executed_per_generation` - Functions per generation

### 🔧 Optimizer Metrics

**Optimization Flow**
- `ax_optimizer_optimization_requests_total` - Total optimization requests
- `ax_optimizer_optimization_duration_ms` - End-to-end optimization time
- `ax_optimizer_optimization_errors_total` - Optimization failures

**Convergence Tracking**
- `ax_optimizer_convergence_rounds` - Rounds until convergence
- `ax_optimizer_convergence_score` - Current best score
- `ax_optimizer_convergence_improvement` - Score improvement from baseline
- `ax_optimizer_stagnation_rounds` - Rounds without improvement
- `ax_optimizer_early_stopping_total` - Early stopping events

**Resource Usage**
- `ax_optimizer_token_usage_total` - Total tokens used during optimization
- `ax_optimizer_cost_usage_total` - Total cost incurred
- `ax_optimizer_memory_usage_bytes` - Peak memory usage
- `ax_optimizer_duration_ms` - Optimization duration

**Teacher-Student Interactions**
- `ax_optimizer_teacher_student_usage_total` - Teacher-student interactions
- `ax_optimizer_teacher_student_latency_ms` - Interaction latency
- `ax_optimizer_teacher_student_score_improvement` - Score improvement from teacher

**Checkpointing**
- `ax_optimizer_checkpoint_save_total` - Checkpoint saves
- `ax_optimizer_checkpoint_load_total` - Checkpoint loads
- `ax_optimizer_checkpoint_save_latency_ms` - Save operation latency
- `ax_optimizer_checkpoint_load_latency_ms` - Load operation latency

**Pareto Optimization**
- `ax_optimizer_pareto_optimizations_total` - Pareto optimization runs
- `ax_optimizer_pareto_front_size` - Size of Pareto frontier
- `ax_optimizer_pareto_hypervolume` - Hypervolume of Pareto frontier
- `ax_optimizer_pareto_solutions_generated` - Solutions generated

**Program Complexity**
- `ax_optimizer_program_input_fields` - Input fields in optimized program
- `ax_optimizer_program_output_fields` - Output fields in optimized program
- `ax_optimizer_examples_count` - Training examples used
- `ax_optimizer_validation_set_size` - Validation set size

### 📊 Database Metrics

**Vector Operations**
- `db_operations_total` - Total DB operations
- `db_query_duration_ms` - Query latency
- `db_upsert_duration_ms` - Upsert latency
- `db_vector_dimensions` - Vector dimensions

### 📈 Example Metrics Output

```json
{
  "name": "ax_llm_request_duration_ms",
  "description": "Duration of LLM requests in milliseconds",
  "unit": "ms",
  "data": {
    "resourceMetrics": [{
      "scopeMetrics": [{
        "metrics": [{
          "name": "ax_llm_request_duration_ms",
          "histogram": {
            "dataPoints": [{
              "attributes": {
                "operation": "chat",
                "ai_service": "openai",
                "model": "gpt-4o-mini"
              },
              "sum": 2450.5,
              "count": 10,
              "bounds": [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
              "bucketCounts": [0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 2]
            }]
          }
        }]
      }]
    }]
  }
}
```

---

## 🔍 Tracing Overview

Ax provides comprehensive distributed tracing following OpenTelemetry standards and the new `gen_ai` semantic conventions.

### 🎯 Trace Structure

**Root Spans**
- `Chat Request` - Complete chat completion flow
- `AI Embed Request` - Embedding generation
- `AxGen` - AxGen generation pipeline
- `DB Query Request` - Vector database operations

**Child Spans**
- `API Call` - HTTP requests to AI providers
- `Function Call` - Tool/function execution
- `Validation` - Response validation
- `Extraction` - Value extraction from responses

### 📋 Standard Attributes

**LLM Attributes** (`gen_ai.*`)
```typescript
{
  'gen_ai.system': 'openai',
  'gen_ai.operation.name': 'chat',
  'gen_ai.request.model': 'gpt-4o-mini',
  'gen_ai.request.max_tokens': 500,
  'gen_ai.request.temperature': 0.1,
  'gen_ai.request.llm_is_streaming': false,
  'gen_ai.usage.input_tokens': 150,
  'gen_ai.usage.output_tokens': 200,
  'gen_ai.usage.total_tokens': 350
}
```

**Database Attributes** (`db.*`)
```typescript
{
  'db.system': 'weaviate',
  'db.operation.name': 'query',
  'db.table': 'documents',
  'db.namespace': 'default',
  'db.vector.query.top_k': 10
}
```

**Custom Ax Attributes**
```typescript
{
  'signature': 'JSON representation of signature',
  'examples': 'JSON representation of examples',
  'provided_functions': 'function1,function2',
  'thinking_token_budget': 'low',
  'show_thoughts': true,
  'max_steps': 5,
  'max_retries': 3
}
```

### 📊 Standard Events

**Message Events**
- `gen_ai.user.message` - User input content
- `gen_ai.system.message` - System prompt content
- `gen_ai.assistant.message` - Assistant response content
- `gen_ai.tool.message` - Function call results

**Usage Events**
- `gen_ai.usage` - Token usage information
- `gen_ai.choice` - Response choices

### 📈 Example Trace Output

```json
{
  "traceId": "ddc7405e9848c8c884e53b823e120845",
  "name": "Chat Request",
  "id": "d376daad21da7a3c",
  "kind": "SERVER",
  "timestamp": 1716622997025000,
  "duration": 14190456.542,
  "attributes": {
    "gen_ai.system": "openai",
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": "gpt-4o-mini",
    "gen_ai.request.max_tokens": 500,
    "gen_ai.request.temperature": 0.1,
    "gen_ai.request.llm_is_streaming": false,
    "gen_ai.usage.input_tokens": 150,
    "gen_ai.usage.output_tokens": 200,
    "gen_ai.usage.total_tokens": 350
  },
  "events": [
    {
      "name": "gen_ai.user.message",
      "timestamp": 1716622997025000,
      "attributes": {
        "content": "What is the capital of France?"
      }
    },
    {
      "name": "gen_ai.assistant.message",
      "timestamp": 1716622997025000,
      "attributes": {
        "content": "The capital of France is Paris."
      }
    }
  ]
}
```

---

## 🎯 Common Observability Patterns

### 1. Performance Monitoring

```typescript
// Monitor latency percentiles
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: {
    tracer,
    meter,
    // Custom latency thresholds
    timeout: 30000,
  },
})

// Set up alerts on high latency
// P95 > 5s, P99 > 10s
```

### 2. Cost Tracking

```typescript
// Track costs by model and operation
const costOptimizer = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o-mini' }, // Cheaper model
  options: { tracer, meter },
})

// Monitor estimated costs
// Alert when daily spend > $100
```

### 3. Error Rate Monitoring

```typescript
// Track error rates by service
const reliableAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: {
    tracer,
    meter,
    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000,
  },
})

// Set up alerts on error rate > 5%
```

### 4. Function Call Monitoring

```typescript
// Monitor function call success rates
const functionAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: { tracer, meter },
})

// Track function call latency and success rates
// Alert on function call failures
```

### 5. Streaming Performance

```typescript
// Monitor streaming response times
const streamingAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { stream: true },
  options: { tracer, meter },
})

// Track time to first token
// Monitor streaming completion rates
```

---

## 🏗️ Production Setup

### 1. Jaeger Tracing Setup

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

// Start Jaeger locally
// docker run --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.6.0

const otlpExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
})

const provider = new BasicTracerProvider({
  spanProcessors: [new BatchSpanProcessor(otlpExporter)],
  resource: defaultResource().merge(
    resourceFromAttributes({
      'service.name': 'my-ai-app',
      'service.version': '1.0.0',
    })
  ),
})

trace.setGlobalTracerProvider(provider)
```

### 2. Prometheus Metrics Setup

```typescript
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'

const prometheusExporter = new PrometheusExporter({
  port: 9464,
  endpoint: '/metrics',
})

const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: prometheusExporter,
      exportIntervalMillis: 1000,
    }),
  ],
})

metrics.setGlobalMeterProvider(meterProvider)
```

### 3. Cloud Observability Setup

```typescript
// For AWS X-Ray, Google Cloud Trace, Azure Monitor, etc.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'

const cloudExporter = new OTLPTraceExporter({
  url: 'https://your-observability-endpoint.com/v1/traces',
  headers: {
    'Authorization': `Bearer ${process.env.OBSERVABILITY_API_KEY}`,
  },
})

const cloudMetricsExporter = new OTLPMetricExporter({
  url: 'https://your-observability-endpoint.com/v1/metrics',
  headers: {
    'Authorization': `Bearer ${process.env.OBSERVABILITY_API_KEY}`,
  },
})
```

### 4. Environment-Specific Configuration

```typescript
// config/telemetry.ts
export const setupTelemetry = (environment: 'development' | 'production') => {
  if (environment === 'development') {
    // Console export for local development
    const consoleExporter = new ConsoleSpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(consoleExporter)],
    })
    trace.setGlobalTracerProvider(provider)
  } else {
    // Production setup with sampling and batching
    const otlpExporter = new OTLPTraceExporter({
      url: process.env.OTLP_ENDPOINT!,
    })
    
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new BatchSpanProcessor(otlpExporter, {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5000,
        }),
      ],
    })
    
    trace.setGlobalTracerProvider(provider)
  }
}
```

---

## ⚡ Advanced Configuration

### 1. Custom Metrics

```typescript
// Create custom business metrics
const customMeter = metrics.getMeter('business-metrics')
const customCounter = customMeter.createCounter('business_operations_total', {
  description: 'Total business operations',
})

// Record custom metrics
customCounter.add(1, {
  operation_type: 'sentiment_analysis',
  customer_tier: 'premium',
})
```

### 2. Custom Spans

```typescript
// Create custom spans for business logic
const tracer = trace.getTracer('business-logic')

const processOrder = async (orderId: string) => {
  return await tracer.startActiveSpan(
    'Process Order',
    {
      attributes: {
        'order.id': orderId,
        'business.operation': 'order_processing',
      },
    },
    async (span) => {
      try {
        // Your business logic here
        const result = await ai.chat({ /* ... */ })
        
        span.setAttributes({
          'order.status': 'completed',
          'order.value': result.total,
        })
        
        return result
      } catch (error) {
        span.recordException(error)
        span.setAttributes({ 'order.status': 'failed' })
        throw error
      } finally {
        span.end()
      }
    }
  )
}
```

### 3. Sampling Configuration

```typescript
// Configure sampling for high-traffic applications
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base'

const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1), // Sample 10% of traces
})

const provider = new BasicTracerProvider({
  sampler,
  spanProcessors: [new BatchSpanProcessor(otlpExporter)],
})
```

### 4. Metrics Configuration

```typescript
// Configure metrics collection
import { axUpdateMetricsConfig, axUpdateOptimizerMetricsConfig } from '@ax-llm/ax'

// Configure DSPy metrics
axUpdateMetricsConfig({
  enabled: true,
  enabledCategories: ['generation', 'streaming', 'functions', 'errors', 'performance'],
  maxLabelLength: 100,
  samplingRate: 1.0, // Collect all metrics
})

// Configure optimizer metrics
axUpdateOptimizerMetricsConfig({
  enabled: true,
  enabledCategories: [
    'optimization',
    'convergence', 
    'resource_usage',
    'teacher_student',
    'checkpointing',
    'pareto'
  ],
  maxLabelLength: 100,
  samplingRate: 1.0
})
```

### 5. Optimizer Metrics Usage

```typescript
// Optimizer metrics are automatically collected when using optimizers
import { AxBootstrapFewShot } from '@ax-llm/ax'

const optimizer = new AxBootstrapFewShot({
  studentAI: ai,
  examples: trainingExamples,
  validationSet: validationExamples,
  targetScore: 0.9,
  verbose: true,
  options: {
    maxRounds: 5,
  },
})

// Metrics are automatically recorded during optimization
const result = await optimizer.compile(program, metricFn)

// Check optimization metrics
console.log('Optimization duration:', result.stats.resourceUsage.totalTime)
console.log('Total tokens used:', result.stats.resourceUsage.totalTokens)
console.log('Convergence info:', result.stats.convergenceInfo)
```

### 6. Global Telemetry Setup

```typescript
// Set up global telemetry for all Ax operations
import { axGlobals } from '@ax-llm/ax'

// Global tracer
axGlobals.tracer = trace.getTracer('global-ax-tracer')

// Global meter
axGlobals.meter = metrics.getMeter('global-ax-meter')

// Now all Ax operations will use these by default
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  // No need to specify tracer/meter - uses globals
})
```

---

## 🛠️ Troubleshooting Guide

### Common Issues

**1. No traces appearing**
```typescript
// Check if tracer is properly configured
console.log('Tracer:', trace.getTracer('test'))
console.log('Provider:', trace.getTracerProvider())

// Ensure spans are being created
const span = tracer.startSpan('test')
span.end()
```

**2. Metrics not updating**
```typescript
// Check meter configuration
console.log('Meter:', metrics.getMeter('test'))
console.log('Provider:', metrics.getMeterProvider())

// Verify metric collection
const testCounter = meter.createCounter('test_counter')
testCounter.add(1)
```

**3. High memory usage**
```typescript
// Reduce metric cardinality
axUpdateMetricsConfig({
  maxLabelLength: 50, // Shorter labels
  samplingRate: 0.1, // Sample 10% of metrics
})

// Use batch processing for spans
const batchProcessor = new BatchSpanProcessor(exporter, {
  maxQueueSize: 1024, // Smaller queue
  maxExportBatchSize: 256, // Smaller batches
})
```

**4. Slow performance**
```typescript
// Use async exporters
const asyncExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
  timeoutMillis: 30000,
})

// Configure appropriate sampling
const sampler = new TraceIdRatioBasedSampler(0.01) // Sample 1%
```

### Debug Mode

```typescript
// Enable debug mode for detailed logging
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: {
    debug: true, // Detailed logging
    tracer,
    meter,
  },
})

// Check debug output for telemetry information
```

---

## 🎓 Best Practices

### 1. Naming Conventions

```typescript
// Use consistent naming for tracers and meters
const tracer = trace.getTracer('my-app.ai-service')
const meter = metrics.getMeter('my-app.ai-service')

// Use descriptive span names
const span = tracer.startSpan('Sentiment Analysis Request')
```

### 2. Attribute Management

```typescript
// Use standard attributes when possible
span.setAttributes({
  'gen_ai.system': 'openai',
  'gen_ai.operation.name': 'chat',
  'gen_ai.request.model': 'gpt-4o-mini',
})

// Add business context
span.setAttributes({
  'business.customer_id': customerId,
  'business.operation_type': 'sentiment_analysis',
})
```

### 3. Error Handling

```typescript
// Always record exceptions in spans
try {
  const result = await ai.chat(request)
  return result
} catch (error) {
  span.recordException(error)
  span.setAttributes({ 'error.type': error.name })
  throw error
} finally {
  span.end()
}
```

### 4. Performance Optimization

```typescript
// Use batch processing for high-volume applications
const batchProcessor = new BatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
})

// Configure appropriate sampling
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1), // 10% sampling
})
```

### 5. Security Considerations

```typescript
// Exclude sensitive content from traces
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: {
    excludeContentFromTrace: true, // Don't log prompt content
    tracer,
  },
})

// Use secure headers for cloud exporters
const secureExporter = new OTLPTraceExporter({
  url: process.env.OTLP_ENDPOINT!,
  headers: {
    'Authorization': `Bearer ${process.env.API_KEY}`,
  },
})
```

---

## 📖 Complete Examples

### 1. Full Production Setup

```typescript
// examples/production-telemetry.ts
import { AxAI, ax, f } from '@ax-llm/ax'
import { trace, metrics } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

// Production telemetry setup
const setupProductionTelemetry = () => {
  // Tracing setup
  const traceExporter = new OTLPTraceExporter({
    url: process.env.OTLP_TRACE_ENDPOINT!,
    headers: { 'Authorization': `Bearer ${process.env.OTLP_API_KEY}` },
  })
  
  const traceProvider = new BasicTracerProvider({
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  })
  trace.setGlobalTracerProvider(traceProvider)
  
  // Metrics setup
  const metricExporter = new OTLPMetricExporter({
    url: process.env.OTLP_METRIC_ENDPOINT!,
    headers: { 'Authorization': `Bearer ${process.env.OTLP_API_KEY}` },
  })
  
  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000,
      }),
    ],
  })
  metrics.setGlobalMeterProvider(meterProvider)
}

// Initialize telemetry
setupProductionTelemetry()

// Create AI with telemetry
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o-mini' },
  options: {
    tracer: trace.getTracer('production-ai'),
    meter: metrics.getMeter('production-ai'),
    debug: process.env.NODE_ENV === 'development',
  },
})

// Create generator
const sentimentAnalyzer = ax`
  reviewText:${f.string('Customer review')} -> 
  sentiment:${f.class(['positive', 'negative', 'neutral'], 'Sentiment')},
  confidence:${f.number('Confidence score 0-1')}
`

// Usage with full observability
export const analyzeSentiment = async (review: string) => {
  const result = await sentimentAnalyzer.forward(ai, { reviewText: review })
  return result
}
```

### 2. Multi-Service Tracing

```typescript
// examples/multi-service-tracing.ts
import { AxAI, AxFlow } from '@ax-llm/ax'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('multi-service')

// Create AI services
const fastAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o-mini' },
  options: { tracer },
})

const powerfulAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o' },
  options: { tracer },
})

// Create multi-service workflow
const documentProcessor = new AxFlow<
  { document: string },
  { summary: string; analysis: string }
>()
  .n('summarizer', 'documentText:string -> summary:string')
  .n('analyzer', 'documentText:string -> analysis:string')
  
  .e('summarizer', s => ({ documentText: s.document }), { ai: fastAI })
  .e('analyzer', s => ({ documentText: s.document }), { ai: powerfulAI })
  
  .m(s => ({
    summary: s.summarizerResult.summary,
    analysis: s.analyzerResult.analysis,
  }))

// Each step gets its own span with proper parent-child relationships
export const processDocument = async (document: string) => {
  return await documentProcessor.forward(fastAI, { document })
}
```

### 3. Custom Business Metrics

```typescript
// examples/custom-business-metrics.ts
import { AxAI, ax, f } from '@ax-llm/ax'
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('business-metrics')

// Create custom business metrics
const customerSatisfactionGauge = meter.createGauge('customer_satisfaction_score', {
  description: 'Customer satisfaction score',
})

const orderProcessingHistogram = meter.createHistogram('order_processing_duration_ms', {
  description: 'Order processing time',
  unit: 'ms',
})

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  options: { meter },
})

const orderAnalyzer = ax`
  orderText:${f.string('Order description')} -> 
  category:${f.class(['urgent', 'normal', 'low'], 'Priority')},
  estimatedTime:${f.number('Estimated processing time in hours')}
`

export const processOrder = async (orderText: string) => {
  const startTime = performance.now()
  
  try {
    const result = await orderAnalyzer.forward(ai, { orderText })
    
    // Record business metrics
    const processingTime = performance.now() - startTime
    orderProcessingHistogram.record(processingTime, {
      category: result.category,
    })
    
    // Update satisfaction score based on processing time
    const satisfactionScore = processingTime < 1000 ? 0.9 : 0.7
    customerSatisfactionGauge.record(satisfactionScore, {
      order_type: result.category,
    })
    
    return result
  } catch (error) {
    // Record error metrics
    customerSatisfactionGauge.record(0.0, {
      order_type: 'error',
    })
    throw error
  }
}
```

---

## 🎯 Key Takeaways

### ✅ What You've Learned

1. **Complete Observability**: Ax provides comprehensive metrics and tracing out of the box
2. **Industry Standards**: Uses OpenTelemetry and `gen_ai` semantic conventions
3. **Zero Configuration**: Works immediately with minimal setup
4. **Production Ready**: Scales from development to enterprise environments
5. **Cost Optimization**: Track usage and costs to optimize spending

### 🚀 Next Steps

1. **Start Simple**: Begin with console export for development
2. **Add Production**: Set up cloud observability for production
3. **Custom Metrics**: Add business-specific metrics
4. **Alerting**: Set up alerts on key metrics
5. **Optimization**: Use data to optimize performance and costs

### 📚 Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Gen AI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai/)
- [Ax Examples](https://github.com/ax-llm/ax/tree/main/src/examples)
- [Telemetry Example](https://github.com/ax-llm/ax/blob/main/src/examples/telemetry.ts)
- [Metrics Export Example](https://github.com/ax-llm/ax/blob/main/src/examples/metrics-export.ts)

### 🎉 You're Ready!

You now have the knowledge to build observable, production-ready AI applications with Ax. Start with the quick setup, add production telemetry, and watch your AI systems become transparent and optimizable!

---

*Need help? Check out the [Ax documentation](https://ax-llm.com) or join our [community](https://github.com/ax-llm/ax/discussions).* 