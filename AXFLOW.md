# AxFlow, The DSPy Compute Graph

**Goal**: Learn how to build complex, stateful AI workflows that orchestrate
multiple models, handle control flow, and scale to production with automatic
performance optimization and robust error handling. **Time to first results**:
10 minutes\
**Value**: Build systems that would take hours with traditional approaches in
minutes, with automatic 1.5-3x performance improvements and production-ready
reliability

## 📋 Table of Contents

- [What is AxFlow?](#what-is-axflow)
- [🚀 10-Minute Quick Start](#-10-minute-quick-start) ← **Start here!**
- [📚 Core Concepts Explained](#-core-concepts-explained)
- [🎯 Common Patterns (Copy & Paste Ready)](#-common-patterns-copy--paste-ready)
- [🏗️ Building Production Systems](#️-building-production-systems)
- [⚡ Advanced Patterns](#-advanced-patterns)
- [🛡️ Error Handling & Resilience](#️-error-handling--resilience) ← **New!**
- [⚡ Performance Optimization](#-performance-optimization) ← **New!**
- [🛠️ Troubleshooting Guide](#️-troubleshooting-guide)
- [🎓 Best Practices](#-best-practices)
- [📖 Complete Real-World Examples](#-complete-real-world-examples)
- [🎯 Key Takeaways](#-key-takeaways)

---

## What is AxFlow?

Think of AxFlow as **LEGO blocks for AI programs**. Instead of writing complex
orchestration code, you:

- **Chain AI operations** with simple, readable syntax
- **Mix different models** for different tasks (fast for simple, powerful for
  complex)
- **Add loops and conditions** without boilerplate code
- **Get automatic state management** - no manual data passing
- **Scale to production** with built-in streaming, tracing, error handling, and
  resilience
- **Handle failures gracefully** with retries, circuit breakers, and fallback
  strategies ← **New!**
- **Optimize performance** with concurrency control and resource-aware
  scheduling ← **New!**

**Real example**: A content creation pipeline that takes 200+ lines of manual
orchestration code and reduces it to 20 lines of AxFlow, with automatic error
handling and performance optimization.

### ⚡ Two Modes of Operation

AxFlow operates in two distinct modes:

1. **Direct Signature Execution** (Simple AI calls)
   ```typescript
   // When no nodes are added, AxFlow executes the signature directly
   const simpleFlow = new AxFlow("userQuestion:string -> answerText:string");
   const result = await simpleFlow.forward(ai, { userQuestion: "What is AI?" });
   // Acts like a simple AxGen - perfect for straightforward AI calls
   ```

2. **Complex Flow Orchestration** (Multi-step workflows)
   ```typescript
   // When nodes are added, AxFlow orchestrates the workflow
   const complexFlow = new AxFlow("inputText:string -> outputText:string")
     .node("processor", "textContent:string -> processedText:string")
     .execute("processor", (state) => ({ textContent: state.inputText }))
     .map((state) => ({ outputText: state.processorResult.processedText }));
   ```

This dual-mode design means you can start simple and evolve to complex without
changing your core API.

### 🗺️ Learning Path

```
Beginner      → Intermediate    → Advanced       → Production
     ↓              ↓               ↓                ↓
Quick Start  → Multi-Model   → Complex Flows   → Enterprise + Resilience
```

---

## 🚀 10-Minute Quick Start

### Step 1: Setup Your Multi-Model Environment

```typescript
import { AxAI, AxFlow } from "@ax-llm/ax";

// Fast & cheap model for simple tasks
const speedAI = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});

// Powerful model for complex analysis
const powerAI = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o" },
});
```

### Step 2: Build Your First Production-Ready AI Workflow

```typescript
// Let's build a smart document processor with error handling
const documentProcessor = new AxFlow<
  { document: string },
  { summary: string; insights: string; actionItems: string[] }
>(
  // ← NEW! Configure error handling and performance
  {
    errorHandling: {
      maxRetries: 3,
      backoffType: "exponential",
      fallbackStrategy: "graceful",
    },
    performance: {
      maxConcurrency: 5,
      resourceLimits: { tokensPerMinute: 10000 },
    },
  },
)
  // Define what each step does (now uses instances only)
  .n("summarizer", "documentText:string -> summary:string")
  .n("analyzer", "documentText:string -> insights:string")
  .n("extractor", "documentText:string -> actionItems:string[]")
  // Use fast model for summary (simple task) with error handling
  .e("summarizer", (s) => ({ documentText: s.document }), {
    ai: speedAI,
    errorHandling: { retries: 2, fallbackStrategy: "continue" },
  })
  // Use powerful model for insights (complex task)
  .e("analyzer", (s) => ({ documentText: s.document }), { ai: powerAI })
  // Use fast model for extraction (pattern matching)
  .e("extractor", (s) => ({ documentText: s.document }), { ai: speedAI })
  // Combine all results with enhanced type safety
  .m((s) => ({
    summary: s.summarizerResult.summary,
    insights: s.analyzerResult.insights,
    actionItems: s.extractorResult.actionItems,
  }));
```

### Step 3: Run Your AI System

```typescript
const testDocument = `
  Meeting Notes: Q4 Planning Session
  - Revenue target: $2M (up 40% from Q3)
  - New hiring: 5 engineers, 2 designers
  - Product launch: December 15th
  - Budget concerns: Marketing spend too high
  - Action needed: Reduce customer acquisition cost
`;

console.log("🔄 Processing document through AI workflow...");
const result = await documentProcessor.forward(powerAI, {
  document: testDocument,
});

console.log("📄 Summary:", result.summary);
console.log("💡 Insights:", result.insights);
console.log("✅ Action Items:", result.actionItems);
```

**🎉 Congratulations!** You just built a multi-model AI system that processes
documents intelligently, using the right model for each task.

### Step 4: Add Intelligence with Loops and Error Recovery

```typescript
// Let's make it iterative with error recovery - keep improving until quality is high
const smartProcessor = new AxFlow<
  { document: string },
  { finalOutput: string }
>(
  {
    errorHandling: {
      maxRetries: 2,
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 30000,
      },
    },
  },
)
  .n("processor", "documentText:string -> processedContent:string")
  .n("qualityChecker", "content:string -> qualityScore:number, feedback:string")
  // Initialize with the document
  .m((s) => ({ currentContent: s.document, iteration: 0 }))
  // Keep improving until quality score > 0.8 or max 3 iterations
  .wh((s) =>
    s.iteration < 3 && (s.qualityCheckerResult?.qualityScore || 0) < 0.8
  )
  .e("processor", (s) => ({ documentText: s.currentContent }), {
    errorHandling: { retries: 3, onError: "continue" },
  })
  .e("qualityChecker", (s) => ({ content: s.processorResult.processedContent }))
  .m((s) => ({
    currentContent: s.processorResult.processedContent,
    iteration: s.iteration + 1,
    qualityCheckerResult: s.qualityCheckerResult,
  }))
  .end()
  .m((s) => ({ finalOutput: s.currentContent }));

// This will automatically improve the output until it meets quality standards
// with built-in error recovery and retry logic!
```

---

## 📚 Core Concepts Explained

### 1. Nodes vs Execution

**Nodes** = What can be done (declare capabilities) **Execution** = When and how
to do it (orchestrate the flow)

```typescript
// DECLARE what's possible
.n('translator', 'text:string, language:string -> translatedText:string')
.n('validator', 'translatedText:string -> isAccurate:boolean')

// ORCHESTRATE when it happens
.e('translator', s => ({ text: s.input, language: 'Spanish' }))
.e('validator', s => ({ translatedText: s.translatorResult.translatedText }))
```

### 2. State Evolution

Your state object **grows** as you execute nodes:

```typescript
// Initial state: { userInput: "Hello" }
.e('translator', ...)
// State now: { userInput: "Hello", translatorResult: { translatedText: "Hola" } }
.e('validator', ...)
// State now: { userInput: "Hello", translatorResult: {...}, validatorResult: { isAccurate: true } }
```

### 3. The Power of Aliases

Long method names vs compact aliases:

```typescript
// Verbose (for learning)
flow.node("analyzer", signature)
  .execute("analyzer", mapping)
  .map(transformation);

// Compact (for production)
flow.n("analyzer", signature)
  .e("analyzer", mapping)
  .m(transformation);
```

### 4. Multi-Model Intelligence

**Use the right tool for the job:**

```typescript
const tasks = {
  simple: speedAI, // Classification, extraction, formatting
  complex: powerAI, // Analysis, reasoning, strategy
  creative: creativityAI, // Writing, brainstorming, design
}
  .e("classifier", mapping, { ai: tasks.simple })
  .e("strategist", mapping, { ai: tasks.complex })
  .e("writer", mapping, { ai: tasks.creative });
```

### 5. Node Types: Signatures vs Custom Programs

AxFlow supports multiple ways to define nodes:

**String Signatures** (creates AxGen):

```typescript
.n('summarizer', 'text:string -> summary:string')
.n('analyzer', 'text:string -> analysis:string, confidence:number')
```

**AxSignature Instances** (creates AxGen):

```typescript
const sig = new AxSignature("text:string -> summary:string")
  .n("summarizer", sig, { debug: true });
```

**AxGen Instances** (uses directly):

```typescript
const summarizer = new AxGen("text:string -> summary:string", {
  temperature: 0.1,
})
  .n("summarizer", summarizer);
```

**AxFlow or AxAgent Instances** (uses directly):

```typescript
// Use AxAgent as a node
const agent = new AxAgent("userQuery:string -> agentResponse:string")
  .n("agent", agent); // Uses instance directly

// Use AxFlow as a node (sub-flow)
const subFlow = new AxFlow("input:string -> processedOutput:string")
  .n("processor", "input:string -> processed:string")
  .e("processor", (s) => ({ input: s.input }))
  .m((s) => ({ processedOutput: s.processorResult.processed }))
  .n("subFlow", subFlow); // Uses instance directly
```

**🎯 Key Benefits of Custom Programs:**

- **No AI calls**: Execute custom logic, data processing, or API calls
- **Reusability**: Share custom logic across multiple flows
- **Performance**: Avoid LLM latency for deterministic operations
- **Cost savings**: Use AI only when needed
- **Composability**: Mix AI and non-AI operations seamlessly
- **Agent integration**: Use AxAgent for tool-based workflows
- **Flow composition**: Use AxFlow for complex sub-workflows
- **Instance-based**: Enhanced type safety and performance with direct instance
  usage ← **New!**

---

## 🎯 Common Patterns (Copy & Paste Ready)

### 1. Multi-Step Content Creation

```typescript
const contentCreator = new AxFlow<
  { topic: string; audience: string },
  { article: string }
>()
  .n("researcher", "topic:string -> keyPoints:string[]")
  .n("outliner", "keyPoints:string[], audience:string -> outline:string")
  .n("writer", "outline:string, audience:string -> article:string")
  .e("researcher", (s) => ({ topic: s.topic }))
  .e("outliner", (s) => ({
    keyPoints: s.researcherResult.keyPoints,
    audience: s.audience,
  }))
  .e("writer", (s) => ({
    outline: s.outlinerResult.outline,
    audience: s.audience,
  }))
  .m((s) => ({ article: s.writerResult.article }));

// Usage
const article = await contentCreator.forward(ai, {
  topic: "Sustainable AI in Healthcare",
  audience: "Healthcare professionals",
});
```

### 2. Conditional Processing

```typescript
const smartRouter = new AxFlow<
  { query: string; complexity: string },
  { response: string }
>()
  .n("simpleHandler", "query:string -> response:string")
  .n("complexHandler", "query:string -> response:string")
  // Branch based on complexity
  .b((s) => s.complexity)
  .w("simple")
  .e("simpleHandler", (s) => ({ query: s.query }), { ai: speedAI })
  .w("complex")
  .e("complexHandler", (s) => ({ query: s.query }), { ai: powerAI })
  .merge()
  .m((s) => ({
    response: s.simpleHandlerResult?.response ||
      s.complexHandlerResult?.response,
  }));
```

### 3. Automatic Parallelization (New! 🚀)

**Zero-config performance optimization** - AxFlow automatically analyzes
dependencies and runs independent operations in parallel!

```typescript
const autoParallelAnalyzer = new AxFlow<
  { text: string },
  { combinedAnalysis: string }
>()
  .node("sentimentAnalyzer", "text:string -> sentiment:string")
  .node("topicExtractor", "text:string -> topics:string[]")
  .node("entityRecognizer", "text:string -> entities:string[]")
  .node(
    "combiner",
    "sentiment:string, topics:string[], entities:string[] -> combinedAnalysis:string",
  )
  // These three run automatically in parallel! ⚡
  .execute("sentimentAnalyzer", (s) => ({ text: s.text }))
  .execute("topicExtractor", (s) => ({ text: s.text }))
  .execute("entityRecognizer", (s) => ({ text: s.text }))
  // This waits for all three to complete, then runs
  .execute("combiner", (s) => ({
    sentiment: s.sentimentAnalyzerResult.sentiment,
    topics: s.topicExtractorResult.topics,
    entities: s.entityRecognizerResult.entities,
  }))
  .map((s) => ({ combinedAnalysis: s.combinerResult.combinedAnalysis }));

// 🎯 Execution Plan:
// Level 0 (Parallel): sentimentAnalyzer, topicExtractor, entityRecognizer
// Level 1 (Sequential): combiner (waits for Level 0)
// Level 2 (Sequential): map (waits for Level 1)

// ⚡ Result: Automatic 1.5-3x speedup with zero code changes!
```

**How It Works:**

- **Dependency Analysis**: Automatically detects which fields each operation
  depends on
- **Parallel Grouping**: Groups operations that can run simultaneously into
  execution levels
- **Optimal Execution**: Runs each level in parallel, waits for completion
  before starting the next level

**Control Options:**

```typescript
// Disable auto-parallelization globally
const sequentialFlow = new AxFlow(signature, { autoParallel: false });

// Disable for a specific execution
const result = await flow.forward(ai, input, { autoParallel: false });

// Debug execution plan
console.log(flow.getExecutionPlan());
// Output: { parallelGroups: 3, maxParallelism: 3, ... }
```

### 4. Manual Parallel Processing

For complex scenarios where you need full control, use manual parallel
processing:

```typescript
const manualParallelAnalyzer = new AxFlow<
  { text: string },
  { combinedAnalysis: string }
>()
  .n("sentimentAnalyzer", "text:string -> sentiment:string")
  .n("topicExtractor", "text:string -> topics:string[]")
  .n("entityRecognizer", "text:string -> entities:string[]")
  // Manual parallel control with .p()
  .p([
    (flow) => flow.e("sentimentAnalyzer", (s) => ({ text: s.text })),
    (flow) => flow.e("topicExtractor", (s) => ({ text: s.text })),
    (flow) => flow.e("entityRecognizer", (s) => ({ text: s.text })),
  ])
  .merge("combinedAnalysis", (sentiment, topics, entities) => {
    return `Sentiment: ${sentiment.sentiment}, Topics: ${
      topics.topics.join(", ")
    }, Entities: ${entities.entities.join(", ")}`;
  });
```

### 5. Quality-Driven Loops

```typescript
const qualityWriter = new AxFlow<
  { brief: string },
  { finalContent: string }
>()
  .n("writer", "brief:string -> content:string")
  .n("critic", "content:string -> score:number, feedback:string")
  .n("reviser", "content:string, feedback:string -> revisedContent:string")
  .m((s) => ({ currentContent: "", iteration: 0 }))
  // Write initial version
  .e("writer", (s) => ({ brief: s.brief }))
  .m((s) => ({ ...s, currentContent: s.writerResult.content }))
  // Improve until score > 0.8 or max 5 iterations
  .wh((s) => s.iteration < 5)
  .e("critic", (s) => ({ content: s.currentContent }))
  .b((s) => s.criticResult.score > 0.8)
  .w(true)
  .m((s) => ({ ...s, iteration: 5 })) // Exit loop
  .w(false)
  .e("reviser", (s) => ({
    content: s.currentContent,
    feedback: s.criticResult.feedback,
  }))
  .m((s) => ({
    ...s,
    currentContent: s.reviserResult.revisedContent,
    iteration: s.iteration + 1,
  }))
  .merge()
  .end()
  .m((s) => ({ finalContent: s.currentContent }));
```

### 6. Self-Healing Workflows

```typescript
const robustProcessor = new AxFlow<
  { input: string },
  { output: string }
>()
  .n("processor", "input:string -> output:string, confidence:number")
  .n("validator", "output:string -> isValid:boolean, issues:string[]")
  .n("fixer", "output:string, issues:string[] -> fixedOutput:string")
  .l("process") // Label for retry point
  .e("processor", (s) => ({ input: s.input }))
  .e("validator", (s) => ({ output: s.processorResult.output }))
  // If validation fails, fix and retry (max 3 times)
  .b((s) => s.validatorResult.isValid)
  .w(false)
  .e("fixer", (s) => ({
    output: s.processorResult.output,
    issues: s.validatorResult.issues,
  }))
  .m((s) => ({
    ...s,
    processorResult: { output: s.fixerResult.fixedOutput, confidence: 0.5 },
  }))
  .fb((s) => !s.validatorResult.isValid, "process", 3)
  .merge()
  .m((s) => ({ output: s.processorResult.output }));
```

### 7. Mixed AI + Custom Logic Workflows

```typescript
// Custom data processor (no AI needed)
class DataCleaner
  extends AxProgramWithSignature<{ rawData: string }, { cleanedData: string }> {
  constructor() {
    super("rawData:string -> cleanedData:string");
  }

  async forward(
    ai: AxAIService,
    values: { rawData: string },
  ): Promise<{ cleanedData: string }> {
    // Custom logic: clean and normalize data
    return {
      cleanedData: values.rawData
        .trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, ""),
    };
  }
}

// Custom API caller (no AI needed)
class WeatherAPI extends AxProgramWithSignature<
  { city: string },
  { temperature: number; conditions: string }
> {
  constructor() {
    super("city:string -> temperature:number, conditions:string");
  }

  async forward(
    ai: AxAIService,
    values: { city: string },
  ): Promise<{ temperature: number; conditions: string }> {
    // Custom logic: call external API
    const response = await fetch(`https://api.weather.com/${values.city}`);
    const data = await response.json();
    return { temperature: data.temp, conditions: data.conditions };
  }
}

const smartWeatherAnalyzer = new AxFlow<
  { userQuery: string },
  { analysis: string; recommendations: string[] }
>()
  .n("dataCleaner", DataCleaner)
  .n("weatherAPI", WeatherAPI)
  .n("analyzer", "cleanedQuery:string, weatherData:object -> analysis:string")
  .n(
    "recommender",
    "analysis:string, weatherData:object -> recommendations:string[]",
  )
  // Clean user input (custom logic)
  .e("dataCleaner", (s) => ({ rawData: s.userQuery }))
  // Extract city and get weather (custom logic)
  .m((s) => ({ city: s.cleanedData.split(" ").pop() || "default" }))
  .e("weatherAPI", (s) => ({ city: s.city }))
  // Analyze with AI
  .e("analyzer", (s) => ({
    cleanedQuery: s.dataCleanerResult.cleanedData,
    weatherData: s.weatherAPIResult,
  }), { ai: powerAI })
  // Generate recommendations with AI
  .e("recommender", (s) => ({
    analysis: s.analyzerResult.analysis,
    weatherData: s.weatherAPIResult,
  }), { ai: powerAI })
  .m((s) => ({
    analysis: s.analyzerResult.analysis,
    recommendations: s.recommenderResult.recommendations,
  }));

// Usage: Mix of custom logic and AI
const result = await smartWeatherAnalyzer.forward(ai, {
  userQuery: "What should I wear in NEW YORK today?",
});
// Custom logic handles data cleaning and API calls
// AI handles analysis and recommendations
```

---

## 🏗️ Building Production Systems

### 1. Error Handling & Resilience

```typescript
const productionFlow = new AxFlow<{ input: string }, { output: string }>()
  .n("primaryProcessor", "input:string -> output:string")
  .n("fallbackProcessor", "input:string -> output:string")
  .n("validator", "output:string -> isValid:boolean")
  // Try primary processor
  .e("primaryProcessor", (s) => ({ input: s.input }), { ai: powerAI })
  .e("validator", (s) => ({ output: s.primaryProcessorResult.output }))
  // Fallback if validation fails
  .b((s) => s.validatorResult.isValid)
  .w(false)
  .e("fallbackProcessor", (s) => ({ input: s.input }), { ai: speedAI })
  .merge()
  .m((s) => ({
    output: s.validatorResult?.isValid
      ? s.primaryProcessorResult.output
      : s.fallbackProcessorResult?.output || "Processing failed",
  }));
```

### 2. Cost Optimization

```typescript
// Start with cheap models, escalate to expensive ones only when needed
const costOptimizedFlow = new AxFlow<
  { task: string; complexity: number },
  { result: string }
>()
  .n("quickProcessor", "task:string -> result:string, confidence:number")
  .n("thoroughProcessor", "task:string -> result:string, confidence:number")
  .n("expertProcessor", "task:string -> result:string, confidence:number")
  // Always try the cheapest first
  .e("quickProcessor", (s) => ({ task: s.task }), { ai: speedAI })
  // Escalate based on confidence and complexity
  .b((s) => s.quickProcessorResult.confidence > 0.7 || s.complexity < 3)
  .w(true)
  // Use quick result
  .m((s) => ({ finalResult: s.quickProcessorResult.result }))
  .w(false)
  // Try medium model
  .e("thoroughProcessor", (s) => ({ task: s.task }), { ai: powerAI })
  .b((s) => s.thoroughProcessorResult.confidence > 0.8)
  .w(true)
  .m((s) => ({ finalResult: s.thoroughProcessorResult.result }))
  .w(false)
  // Last resort: expert model
  .e("expertProcessor", (s) => ({ task: s.task }), { ai: expertAI })
  .m((s) => ({ finalResult: s.expertProcessorResult.result }))
  .merge()
  .merge()
  .m((s) => ({ result: s.finalResult }));
```

### 3. Observability & Monitoring

```typescript
import { trace } from "@opentelemetry/api";

const monitoredFlow = new AxFlow<{ input: string }, { output: string }>()
  .n("step1", "input:string -> intermediate:string")
  .n("step2", "intermediate:string -> output:string")
  // Each step gets traced automatically
  .e("step1", (s) => ({ input: s.input }), {
    ai: ai,
    options: {
      tracer: trace.getTracer("my-flow"),
      debug: process.env.NODE_ENV === "development",
    },
  })
  .e("step2", (s) => ({ intermediate: s.step1Result.intermediate }), {
    ai: ai,
    options: { tracer: trace.getTracer("my-flow") },
  })
  .m((s) => ({ output: s.step2Result.output }));

// Usage with monitoring
const result = await monitoredFlow.forward(ai, { input: "test" }, {
  tracer: trace.getTracer("production-flow"),
  debug: false,
});
```

---

## ⚡ Advanced Patterns

### 1. Dynamic Node Selection

```typescript
const adaptiveFlow = new AxFlow<
  { input: string; userPreferences: object },
  { output: string }
>()
  .n("formal", "input:string -> output:string")
  .n("casual", "input:string -> output:string")
  .n("technical", "input:string -> output:string")
  // Choose processor based on user preferences
  .b((s) => s.userPreferences.style)
  .w("formal").e("formal", (s) => ({ input: s.input }))
  .w("casual").e("casual", (s) => ({ input: s.input }))
  .w("technical").e("technical", (s) => ({ input: s.input }))
  .merge()
  .m((s) => ({
    output: s.formalResult?.output ||
      s.casualResult?.output ||
      s.technicalResult?.output,
  }));
```

### 2. Multi-Round Negotiation

```typescript
const negotiationFlow = new AxFlow<
  { proposal: string; requirements: string },
  { finalAgreement: string }
>()
  .n(
    "evaluator",
    "proposal:string, requirements:string -> score:number, gaps:string[]",
  )
  .n(
    "negotiator",
    "currentProposal:string, gaps:string[] -> counterProposal:string",
  )
  .n("finalizer", "proposal:string, requirements:string -> agreement:string")
  .m((s) => ({
    currentProposal: s.proposal,
    round: 0,
    bestScore: 0,
  }))
  // Negotiate for up to 5 rounds
  .wh((s) => s.round < 5 && s.bestScore < 0.9)
  .e("evaluator", (s) => ({
    proposal: s.currentProposal,
    requirements: s.requirements,
  }))
  .b((s) => s.evaluatorResult.score > s.bestScore)
  .w(true)
  // Improvement found, continue negotiating
  .e("negotiator", (s) => ({
    currentProposal: s.currentProposal,
    gaps: s.evaluatorResult.gaps,
  }))
  .m((s) => ({
    ...s,
    currentProposal: s.negotiatorResult.counterProposal,
    round: s.round + 1,
    bestScore: s.evaluatorResult.score,
  }))
  .w(false)
  // No improvement, exit
  .m((s) => ({ ...s, round: 5 }))
  .merge()
  .end()
  .e("finalizer", (s) => ({
    proposal: s.currentProposal,
    requirements: s.requirements,
  }))
  .m((s) => ({ finalAgreement: s.finalizerResult.agreement }));
```

### 3. Hierarchical Processing

```typescript
const hierarchicalFlow = new AxFlow<
  { document: string },
  { structuredOutput: object }
>()
  .n("sectionExtractor", "document:string -> sections:string[]")
  .n("sectionProcessor", "section:string -> processedSection:object")
  .n("aggregator", "processedSections:object[] -> finalOutput:object")
  // Extract sections
  .e("sectionExtractor", (s) => ({ document: s.document }))
  // Process each section in parallel
  .m((s) => ({
    processedSections: [] as object[],
    totalSections: s.sectionExtractorResult.sections.length,
    currentSection: 0,
  }))
  .wh((s) => s.currentSection < s.totalSections)
  .e("sectionProcessor", (s) => ({
    section: s.sectionExtractorResult.sections[s.currentSection],
  }))
  .m((s) => ({
    ...s,
    processedSections: [
      ...s.processedSections,
      s.sectionProcessorResult.processedSection,
    ],
    currentSection: s.currentSection + 1,
  }))
  .end()
  .e("aggregator", (s) => ({ processedSections: s.processedSections }))
  .m((s) => ({ structuredOutput: s.aggregatorResult.finalOutput }));
```

---

## 🛡️ Error Handling & Resilience

### 1. Circuit Breakers

Prevent cascading failures with automatic circuit breakers:

```typescript
const resilientFlow = new AxFlow<{ input: string }, { output: string }>(
  {
    errorHandling: {
      circuitBreaker: {
        failureThreshold: 5, // Open circuit after 5 failures
        resetTimeoutMs: 30000, // Try again after 30 seconds
        halfOpenMaxCalls: 3, // Test with 3 calls before fully closing
      },
    },
  },
)
  .n("unreliableProcessor", "input:string -> output:string")
  .e("unreliableProcessor", (s) => ({ input: s.input }), {
    errorHandling: {
      onCircuitOpen: "fallback", // Use fallback when circuit is open
      fallbackValue: { output: "Service temporarily unavailable" },
    },
  });
```

### 2. Retry Strategies

Built-in retry mechanisms with exponential backoff:

```typescript
const retryFlow = new AxFlow<{ query: string }, { result: string }>(
  {
    errorHandling: {
      maxRetries: 3,
      backoffType: "exponential", // exponential, linear, or fixed
      baseDelayMs: 1000, // Start with 1 second
      maxDelayMs: 10000, // Cap at 10 seconds
    },
  },
)
  .n("processor", "query:string -> result:string")
  .e("processor", (s) => ({ query: s.query }), {
    errorHandling: {
      retries: 5, // Override global setting
      onError: "retry", // retry, continue, or abort
      backoffMultiplier: 2.0,
    },
  });
```

### 3. Fallback Strategies

Graceful degradation with fallback operations:

```typescript
const robustFlow = new AxFlow<{ input: string }, { output: string }>(
  {
    errorHandling: {
      fallbackStrategy: "graceful", // graceful, abort, or continue
      fallbackAI: speedAI, // Use faster model as fallback
    },
  },
)
  .n("primaryProcessor", "input:string -> output:string, confidence:number")
  .n("fallbackProcessor", "input:string -> output:string")
  .e("primaryProcessor", (s) => ({ input: s.input }), {
    ai: powerAI,
    errorHandling: {
      fallbackNode: "fallbackProcessor",
      fallbackAI: speedAI,
    },
  })
  .e("fallbackProcessor", (s) => ({ input: s.input }), { ai: speedAI });
```

### 4. Error Boundaries

Isolate failures to prevent complete workflow breakdown:

```typescript
const boundedFlow = new AxFlow<{ tasks: string[] }, { results: string[] }>(
  {
    errorHandling: {
      isolateErrors: true, // Don't let one failure stop everything
      continueOnPartialFailure: true,
    },
  },
)
  .n("taskProcessor", "task:string -> result:string")
  .m((s) => ({
    results: [] as string[],
    currentIndex: 0,
    errors: [] as string[],
  }))
  .wh((s) => s.currentIndex < s.tasks.length)
  .e("taskProcessor", (s) => ({
    task: s.tasks[s.currentIndex],
  }), {
    errorHandling: {
      onError: "continue", // Continue with next task on error
      captureError: true, // Capture error details
    },
  })
  .m((s) => ({
    ...s,
    results: [...s.results, s.taskProcessorResult?.result || "Error"],
    currentIndex: s.currentIndex + 1,
    errors: s.taskProcessorResult
      ? s.errors
      : [...s.errors, "Processing failed"],
  }))
  .end();
```

---

## ⚡ Performance Optimization

### 1. Concurrency Control

Manage resource usage with smart concurrency limits:

```typescript
const optimizedFlow = new AxFlow<{ items: string[] }, { processed: string[] }>(
  {
    performance: {
      maxConcurrency: 5, // Max 5 operations in parallel
      resourceLimits: {
        tokensPerMinute: 50000, // Rate limiting
        requestsPerSecond: 10,
        memoryLimitMB: 512,
      },
      queueStrategy: "fifo", // fifo, lifo, or priority
    },
  },
)
  .n("processor", "item:string -> processed:string")
  .p([
    // These will respect the concurrency limit
    ...items.map((_, i) => (flow) =>
      flow.e("processor", (s) => ({ item: s.items[i] }))
    ),
  ])
  .merge("allResults", (...results) => results.map((r) => r.processed));
```

### 2. Resource-Aware Scheduling

Automatic optimization based on resource availability:

```typescript
const smartFlow = new AxFlow<{ workload: string }, { result: string }>(
  {
    performance: {
      adaptiveConcurrency: true, // Adjust based on performance
      resourceMonitoring: {
        cpuThreshold: 80, // Scale down if CPU > 80%
        memoryThreshold: 70, // Scale down if memory > 70%
        responseTimeThreshold: 5000, // Scale down if responses > 5s
      },
      scheduling: {
        strategy: "adaptive", // adaptive, fixed, or dynamic
        priorityWeights: {
          "critical": 1.0,
          "normal": 0.5,
          "low": 0.1,
        },
      },
    },
  },
)
  .n("heavyProcessor", "workload:string -> result:string")
  .e("heavyProcessor", (s) => ({ workload: s.workload }), {
    priority: "critical", // High priority execution
    performance: {
      maxExecutionTimeMs: 30000, // Timeout after 30 seconds
      expectedComplexity: "high", // Hint for resource allocation
    },
  });
```

### 3. Enhanced Type Safety in Merges

Explicit type control for branch merging:

```typescript
interface MergedState {
  result: string;
  method: "fast" | "thorough";
  confidence: number;
}

const typeSafeFlow = new AxFlow<{ input: string }, MergedState>()
  .n("fastProcessor", "input:string -> result:string, confidence:number")
  .n("thoroughProcessor", "input:string -> result:string, confidence:number")
  .b((s) => s.input.length > 100)
  .w(true)
  .e("thoroughProcessor", (s) => ({ input: s.input }))
  .m((s) => ({
    result: s.thoroughProcessorResult.result,
    method: "thorough" as const,
    confidence: s.thoroughProcessorResult.confidence,
  }))
  .w(false)
  .e("fastProcessor", (s) => ({ input: s.input }))
  .m((s) => ({
    result: s.fastProcessorResult.result,
    method: "fast" as const,
    confidence: s.fastProcessorResult.confidence,
  }))
  // Explicitly specify merged type for enhanced safety
  .merge<MergedState>();
```

### 4. Parallel Map with Batch Size Control ← **NEW!**

Execute multiple transformations in parallel with intelligent batch processing for optimal resource management:

#### Basic Parallel Map Usage

```typescript
import { AxFlow } from "@ax-llm/ax";

// Simple parallel map with multiple transforms
const flow = new AxFlow<{ items: string[] }, { results: string[] }>()
  .init({ items: ["item1", "item2", "item3", "item4", "item5"] })
  .map([
    state => ({ ...state, transform1: processItems(state.items, "method1") }),
    state => ({ ...state, transform2: processItems(state.items, "method2") }),
    state => ({ ...state, transform3: processItems(state.items, "method3") })
  ], { parallel: true })
  .map(state => ({ 
    results: combineTransforms([
      state.transform1, state.transform2, state.transform3
    ])
  }));

// ⚡ All three transforms execute simultaneously
const result = await flow.forward(ai, { items: data });
```

#### Batch Size Configuration

Control resource usage and prevent overwhelming downstream services:

```typescript
// Configure batch size for optimal performance
const batchedFlow = new AxFlow<StateType, ResultType>({ 
  batchSize: 5         // Process 5 operations at a time
})
  .init({ largeDataset: thousandsOfItems })
  .map([
    // These 20 transforms will be processed in batches of 5
    ...createTransforms(20)
  ], { parallel: true });

// Execution pattern: [5 parallel] → [5 parallel] → [5 parallel] → [5 parallel]
// Order is preserved despite batched execution
// Example: If you have 23 operations with batchSize: 5
// Batch 1: Operations 1-5 (parallel)
// Batch 2: Operations 6-10 (parallel) 
// Batch 3: Operations 11-15 (parallel)
// Batch 4: Operations 16-20 (parallel)
// Batch 5: Operations 21-23 (parallel)
```

#### Advanced Batch Processing Patterns

**1. Large-Scale Data Processing:**

```typescript
interface DataPoint { id: string; content: string; }
interface ProcessedData { id: string; summary: string; sentiment: string; keywords: string[]; }

const dataProcessor = new AxFlow<
  { dataPoints: DataPoint[] }, 
  { processed: ProcessedData[] }
>({ batchSize: 3 })  // Process 3 items at a time
  .n("summarizer", "content:string -> summary:string")
  .n("sentimentAnalyzer", "content:string -> sentiment:string") 
  .n("keywordExtractor", "content:string -> keywords:string[]")
  .init(state => ({ ...state, processedItems: [] }))
  .map(
    // Create parallel transforms for each data point
    state => state.dataPoints.map(point => (flowState: any) => ({
      ...flowState,
      [`item_${point.id}`]: {
        id: point.id,
        content: point.content,
        processed: false
      }
    })), 
    { parallel: true }
  )
  // Process each item through multiple AI models in parallel
  .map(
    state => state.dataPoints.map(point => (flowState: any) => {
      // This creates a sub-flow for each data point
      return new AxFlow()
        .e("summarizer", s => ({ content: point.content }))
        .e("sentimentAnalyzer", s => ({ content: point.content }))
        .e("keywordExtractor", s => ({ content: point.content }))
        .m(s => ({
          id: point.id,
          summary: s.summarizerResult.summary,
          sentiment: s.sentimentAnalyzerResult.sentiment,
          keywords: s.keywordExtractorResult.keywords
        }))
        .forward(ai, {});
    }),
    { parallel: true }
  );

// ⚡ Processes large datasets efficiently with controlled concurrency
```

**2. Environment-Based Batch Size Configuration:**

```typescript
const adaptiveFlow = new AxFlow<{ tasks: Task[] }, { results: Result[] }>({
  batchSize: process.env.NODE_ENV === 'production' ? 10 : 3  // Adjust based on environment
})
  .init({ tasks: largeBatchOfTasks })
  .map([
    // All these transforms will use the configured batch size
    state => processForAnalytics(state.tasks),
    state => processForReporting(state.tasks), 
    state => processForNotifications(state.tasks),
    state => processForArchiving(state.tasks)
  ], { parallel: true });

// Production: Processes 10 operations at a time (higher throughput)
// Development: Processes 3 operations at a time (easier debugging)
```

**3. Dynamic Batch Size Selection:**

```typescript
// Choose batch size based on data characteristics
function getBatchSize(dataSize: number, operationType: string): number {
  if (operationType === 'heavy-ai-processing') return 2;  // Conservative for expensive ops
  if (operationType === 'simple-transform') return 20;    // Aggressive for fast ops  
  if (dataSize > 1000) return 5;                          // Smaller batches for large datasets
  return 10;                                              // Default batch size
}

const smartFlow = new AxFlow<InputType, OutputType>({
  batchSize: getBatchSize(inputData.length, 'heavy-ai-processing')
})
  .init(inputData)
  .map([
    state => performHeavyAIProcessing(state),
    state => generateSummaries(state),
    state => extractInsights(state)
  ], { parallel: true });

// Automatically adjusts batch size based on workload characteristics
```

#### Performance Benefits & Use Cases

**🚀 Key Benefits:**
- **Memory Management**: Prevents memory spikes from thousands of concurrent operations
- **Rate Limiting**: Works seamlessly with API rate limits and service quotas
- **Resource Control**: Prevents overwhelming downstream services or databases
- **Order Preservation**: Results maintain original order despite batched execution
- **Graceful Scaling**: Automatically adapts to available system resources

**🎯 Perfect For:**
- Processing large datasets (thousands of items)
- API-heavy workflows with rate limiting concerns
- Memory-constrained environments
- Multi-tenant applications with resource sharing
- Production systems requiring predictable resource usage

**⚡ Performance Comparison:**

```typescript
// Without batch control (potentially problematic)
const unboundedFlow = new AxFlow()
  .map(thousandsOfTransforms, { parallel: true }); // 😬 Memory spike!

// With intelligent batching (production-ready)
const batchedFlow = new AxFlow({ batchSize: 10 })
  .map(thousandsOfTransforms, { parallel: true }); // ✅ Controlled execution

// Real-world example with 1000 transforms:
// Unbounded: All 1000 operations start simultaneously 
//   → Memory spike, potential system overload, rate limit issues
// Batched (size 10): 100 sequential batches of 10 parallel operations each
//   → Steady memory usage, predictable performance, maintained order

// Memory usage pattern:
// Unbounded: 📈 Spike to 1000x memory → 📉 All complete at once
// Batched:   📊 Steady 10x memory → 📊 Steady 10x memory → 📊 Steady...
```

---

## 🛠️ Troubleshooting Guide

### Problem: State Type Errors

**Symptom**: TypeScript complains about state properties not existing

```typescript
// ❌ This will cause type errors
.e('processor', s => ({ input: s.nonExistentField }))

// ✅ Fix: Make sure the field exists in current state
.e('processor', s => ({ input: s.userInput }))
```

**Solution**: Use `.m()` to reshape state when needed:

```typescript
.m(s => ({ processedInput: s.originalInput.toLowerCase() }))
.e('processor', s => ({ input: s.processedInput }))
```

### Problem: Node Not Found Errors

**Symptom**: `Node 'nodeName' not found`

```typescript
// ❌ Executing before declaring
.e('processor', mapping)
.n('processor', signature) // Too late!

// ✅ Always declare nodes first
.n('processor', signature)
.e('processor', mapping)
```

### Problem: Infinite Loops

**Symptom**: Workflow never completes

```typescript
// ❌ Condition never changes
.wh(s => s.counter === 0) // counter never increments!
  .e('processor', mapping)
.end()

// ✅ Always update loop condition
.wh(s => s.counter < 5)
  .e('processor', mapping)
  .m(s => ({ ...s, counter: s.counter + 1 })) // Update counter
.end()
```

### Problem: Missing Field Values

**Symptom**: "Value for field 'X' is required" error

**Cause**: LLM not returning expected fields

```typescript
// ✅ Add validation and fallbacks
.e('processor', mapping)
.m(s => ({
  ...s,
  safeOutput: s.processorResult.output || 'Default value'
}))
```

### Problem: Branch Merge Issues

**Symptom**: TypeScript errors after `.merge()`

```typescript
// ❌ Branches create different state shapes
.b(s => s.type)
  .w('A').m(s => ({ resultA: s.data }))
  .w('B').m(s => ({ resultB: s.data }))
.merge() // TypeScript confused about merged type

// ✅ Use consistent state shapes or explicit merge
.b(s => s.type)
  .w('A').m(s => ({ result: s.data, type: 'A' }))
  .w('B').m(s => ({ result: s.data, type: 'B' }))
.merge()
```

### Problem: Automatic Parallelization Not Working

**Symptom**: Expected parallel execution but operations run sequentially

**Debug Steps:**

1. **Check Execution Plan**:

```typescript
const flow = new AxFlow("dataInput:string -> resultOutput:string")
  .node("task1", "inputText:string -> output1:string")
  .node("task2", "inputText:string -> output2:string")
  .execute("task1", (s) => ({ inputText: s.dataInput }))
  .execute("task2", (s) => ({ inputText: s.dataInput }));

// Debug the execution plan
const plan = flow.getExecutionPlan();
console.log("Parallel Groups:", plan.parallelGroups);
console.log("Max Parallelism:", plan.maxParallelism);
console.log("Auto-Parallel Enabled:", plan.autoParallelEnabled);

// Expected output for parallel operations:
// Parallel Groups: 2 (or more)
// Max Parallelism: 2 (or more)
```

2. **Check Dependencies**:

```typescript
// ❌ These look independent but create dependencies
.execute('task1', s => ({ input: s.data }))
.execute('task2', s => ({ input: s.task1Result.output1 })) // Depends on task1!

// ✅ Truly independent operations
.execute('task1', s => ({ input: s.data }))
.execute('task2', s => ({ input: s.data })) // Both depend only on s.data
```

3. **Verify Auto-Parallel is Enabled**:

```typescript
// Check constructor
const flow = new AxFlow(signature, { autoParallel: true }); // Enabled

// Check runtime
const result = await flow.forward(ai, input, { autoParallel: true });
```

4. **Common Causes of Sequential Execution**:

```typescript
// ❌ Mapping dependencies create chains
.execute('task1', s => ({ input: s.data }))
.execute('task2', s => ({ 
  input: s.data,
  context: s.task1Result.output1 // Creates dependency!
}))

// ✅ Independent operations
.execute('task1', s => ({ input: s.data }))
.execute('task2', s => ({ input: s.data }))
.execute('combiner', s => ({ 
  input1: s.task1Result.output1,
  input2: s.task2Result.output2
})) // Combiner waits for both
```

**Performance Debugging:**

```typescript
// Measure performance difference
const start = Date.now();
const autoResult = await flow.forward(ai, input); // Auto-parallel
const autoTime = Date.now() - start;

const start2 = Date.now();
const seqResult = await flow.forward(ai, input, { autoParallel: false });
const seqTime = Date.now() - start2;

console.log(`Speedup: ${(seqTime / autoTime).toFixed(2)}x`);
// Expected: 1.5x - 3x speedup for parallel operations
```

---

## 🎓 Best Practices

### 1. Start Simple, Add Complexity

```typescript
// Phase 1: Basic flow
const v1 = new AxFlow()
  .n("processor", "input:string -> output:string")
  .e("processor", (s) => ({ input: s.userInput }))
  .m((s) => ({ result: s.processorResult.output }));

// Phase 2: Add validation
const v2 = v1
  .n("validator", "output:string -> isValid:boolean")
  .e("validator", (s) => ({ output: s.processorResult.output }));

// Phase 3: Add error handling
// ... continue building incrementally
```

### 2. Use Descriptive Node Names

```typescript
// ❌ Unclear purpose
.n('proc1', signature)
.n('proc2', signature)

// ✅ Clear functionality
.n('documentSummarizer', signature)
.n('sentimentAnalyzer', signature)
.n('actionItemExtractor', signature)
```

### 3. Design for Automatic Parallelization

**Structure your flows to maximize automatic parallelization:**

```typescript
// ✅ Parallel-friendly design
const optimizedFlow = new AxFlow()
  .node("summarizer", "text:string -> summary:string")
  .node("classifier", "text:string -> category:string")
  .node("extractor", "text:string -> entities:string[]")
  .node(
    "combiner",
    "summary:string, category:string, entities:string[] -> result:string",
  )
  // These three run in parallel automatically! ⚡
  .execute("summarizer", (s) => ({ text: s.input }))
  .execute("classifier", (s) => ({ text: s.input }))
  .execute("extractor", (s) => ({ text: s.input }))
  // This waits for all three, then runs
  .execute("combiner", (s) => ({
    summary: s.summarizerResult.summary,
    category: s.classifierResult.category,
    entities: s.extractorResult.entities,
  }));

// ❌ Sequential design (avoid unnecessary dependencies)
const slowFlow = new AxFlow()
  .execute("summarizer", (s) => ({ text: s.input }))
  .execute("classifier", (s) => ({
    text: s.input,
    context: s.summarizerResult.summary, // Unnecessary dependency!
  }))
  .execute("extractor", (s) => ({
    text: s.input,
    category: s.classifierResult.category, // Another unnecessary dependency!
  }));
```

### 4. Model Selection Strategy

```typescript
const models = {
  // Fast & cheap for simple tasks
  classifier: speedAI,
  formatter: speedAI,
  extractor: speedAI,

  // Balanced for medium complexity
  analyzer: balancedAI,
  validator: balancedAI,

  // Powerful for complex reasoning
  strategist: powerAI,
  critic: powerAI,
  synthesizer: powerAI,
}
  // Use appropriate model for each task
  .e("classifier", mapping, { ai: models.classifier })
  .e("strategist", mapping, { ai: models.strategist });
```

### 5. State Management Patterns

```typescript
// ✅ Keep state flat and predictable
.m(s => ({
  // Core data
  originalInput: s.input,
  processedInput: s.input.toLowerCase(),
  
  // Results
  classificationResult: s.classifierResult,
  
  // Metadata
  processingTime: Date.now(),
  version: '1.0'
}))

// ❌ Avoid deep nesting
.m(s => ({
  data: {
    input: {
      original: s.input,
      processed: s.input.toLowerCase()
    }
  }
})) // Hard to access later
```

### 6. Error Boundaries

```typescript
const safeFlow = new AxFlow()
  .n("processor", "input:string -> output:string, confidence:number")
  .n("fallback", "input:string -> output:string")
  // Main processing
  .e("processor", (s) => ({ input: s.userInput }))
  // Fallback if confidence too low
  .b((s) => (s.processorResult?.confidence || 0) > 0.7)
  .w(false)
  .e("fallback", (s) => ({ input: s.userInput }))
  .merge()
  .m((s) => ({
    result: s.processorResult?.confidence > 0.7
      ? s.processorResult.output
      : s.fallbackResult?.output || "Processing failed",
  }));
```

---

## 📖 Complete Real-World Examples

### 1. Customer Support Automation

```typescript
const supportSystem = new AxFlow<
  { customerMessage: string; customerHistory: string },
  { response: string; priority: string; needsHuman: boolean }
>()
  .n("intentClassifier", "message:string -> intent:string, confidence:number")
  .n("priorityAssigner", "message:string, intent:string -> priority:string")
  .n(
    "responseGenerator",
    "message:string, intent:string, history:string -> response:string",
  )
  .n(
    "humanEscalator",
    "message:string, intent:string, response:string -> needsHuman:boolean",
  )
  // Classify customer intent
  .e("intentClassifier", (s) => ({ message: s.customerMessage }), {
    ai: speedAI,
  })
  // Assign priority in parallel
  .p([
    (flow) =>
      flow.e("priorityAssigner", (s) => ({
        message: s.customerMessage,
        intent: s.intentClassifierResult.intent,
      }), { ai: speedAI }),

    (flow) =>
      flow.e("responseGenerator", (s) => ({
        message: s.customerMessage,
        intent: s.intentClassifierResult.intent,
        history: s.customerHistory,
      }), { ai: powerAI }),
  ])
  .merge(
    "processedData",
    (priority, response) => ({ ...priority, ...response }),
  )
  // Check if human intervention needed
  .e("humanEscalator", (s) => ({
    message: s.customerMessage,
    intent: s.intentClassifierResult.intent,
    response: s.processedData.response,
  }), { ai: speedAI })
  .m((s) => ({
    response: s.processedData.response,
    priority: s.processedData.priority,
    needsHuman: s.humanEscalatorResult.needsHuman,
  }));

// Usage
const support = await supportSystem.forward(ai, {
  customerMessage:
    "My order hasn't arrived and I need it for tomorrow's meeting!",
  customerHistory: "Premium customer, 5 previous orders, no complaints",
});
```

### 2. Content Marketing Pipeline

```typescript
const marketingPipeline = new AxFlow<
  { productInfo: string; targetAudience: string; platform: string },
  { finalContent: string; hashtags: string[]; publishTime: string }
>()
  .n(
    "audienceAnalyzer",
    "productInfo:string, audience:string -> insights:string",
  )
  .n(
    "contentCreator",
    "productInfo:string, insights:string, platform:string -> content:string",
  )
  .n("hashtagGenerator", "content:string, platform:string -> hashtags:string[]")
  .n(
    "timingOptimizer",
    "content:string, platform:string, audience:string -> publishTime:string",
  )
  .n("qualityChecker", "content:string -> score:number, suggestions:string[]")
  .n(
    "contentReviser",
    "content:string, suggestions:string[] -> revisedContent:string",
  )
  // Analyze audience
  .e("audienceAnalyzer", (s) => ({
    productInfo: s.productInfo,
    audience: s.targetAudience,
  }), { ai: powerAI })
  // Create initial content
  .e("contentCreator", (s) => ({
    productInfo: s.productInfo,
    insights: s.audienceAnalyzerResult.insights,
    platform: s.platform,
  }), { ai: creativityAI })
  .m((s) => ({ currentContent: s.contentCreatorResult.content, iteration: 0 }))
  // Quality improvement loop
  .wh((s) => s.iteration < 3)
  .e("qualityChecker", (s) => ({ content: s.currentContent }), { ai: powerAI })
  .b((s) => s.qualityCheckerResult.score > 0.8)
  .w(true)
  .m((s) => ({ ...s, iteration: 3 })) // Exit loop
  .w(false)
  .e("contentReviser", (s) => ({
    content: s.currentContent,
    suggestions: s.qualityCheckerResult.suggestions,
  }), { ai: creativityAI })
  .m((s) => ({
    ...s,
    currentContent: s.contentReviserResult.revisedContent,
    iteration: s.iteration + 1,
  }))
  .merge()
  .end()
  // Generate hashtags and timing in parallel
  .p([
    (flow) =>
      flow.e("hashtagGenerator", (s) => ({
        content: s.currentContent,
        platform: s.platform,
      }), { ai: speedAI }),

    (flow) =>
      flow.e("timingOptimizer", (s) => ({
        content: s.currentContent,
        platform: s.platform,
        audience: s.targetAudience,
      }), { ai: speedAI }),
  ])
  .merge("finalData", (hashtags, timing) => ({ ...hashtags, ...timing }))
  .m((s) => ({
    finalContent: s.currentContent,
    hashtags: s.finalData.hashtags,
    publishTime: s.finalData.publishTime,
  }));

// Usage
const marketing = await marketingPipeline.forward(ai, {
  productInfo: "New AI-powered fitness tracker with 7-day battery life",
  targetAudience: "Health-conscious millennials",
  platform: "Instagram",
});
```

### 3. Research & Analysis System

```typescript
const researchSystem = new AxFlow<
  { researchTopic: string; depth: string },
  { report: string; sources: string[]; confidence: number }
>()
  .n("queryGenerator", "topic:string -> searchQueries:string[]")
  .n("sourceCollector", "queries:string[] -> rawSources:string[]")
  .n(
    "sourceValidator",
    "sources:string[] -> validSources:string[], confidence:number",
  )
  .n("synthesizer", "topic:string, sources:string[] -> report:string")
  .n(
    "factChecker",
    "report:string, sources:string[] -> isAccurate:boolean, issues:string[]",
  )
  .n("reportRefiner", "report:string, issues:string[] -> refinedReport:string")
  // Generate search queries
  .e("queryGenerator", (s) => ({ topic: s.researchTopic }), { ai: powerAI })
  // Collect and validate sources
  .e(
    "sourceCollector",
    (s) => ({ queries: s.queryGeneratorResult.searchQueries }),
  )
  .e(
    "sourceValidator",
    (s) => ({ sources: s.sourceCollectorResult.rawSources }),
    { ai: powerAI },
  )
  // Initial synthesis
  .e("synthesizer", (s) => ({
    topic: s.researchTopic,
    sources: s.sourceValidatorResult.validSources,
  }), { ai: powerAI })
  .m((s) => ({ currentReport: s.synthesizerResult.report, iteration: 0 }))
  // Fact-checking and refinement loop
  .wh((s) => s.iteration < 2) // Max 2 refinement rounds
  .e("factChecker", (s) => ({
    report: s.currentReport,
    sources: s.sourceValidatorResult.validSources,
  }), { ai: powerAI })
  .b((s) => s.factCheckerResult.isAccurate)
  .w(true)
  .m((s) => ({ ...s, iteration: 2 })) // Exit loop
  .w(false)
  .e("reportRefiner", (s) => ({
    report: s.currentReport,
    issues: s.factCheckerResult.issues,
  }), { ai: powerAI })
  .m((s) => ({
    ...s,
    currentReport: s.reportRefinerResult.refinedReport,
    iteration: s.iteration + 1,
  }))
  .merge()
  .end()
  .m((s) => ({
    report: s.currentReport,
    sources: s.sourceValidatorResult.validSources,
    confidence: s.sourceValidatorResult.confidence,
  }));

// Usage
const research = await researchSystem.forward(ai, {
  researchTopic: "Impact of AI on renewable energy optimization",
  depth: "comprehensive",
});
```

---

## 🎯 Key Takeaways

### ✅ When to Use AxFlow

- **Multi-step AI processes** that need orchestration
- **Different models for different tasks** (cost optimization)
- **Conditional logic** in your AI workflows
- **Iterative improvement** patterns
- **Production systems** that need reliability and observability

### ✅ AxFlow Superpowers

1. **Readable Code**: Workflows read like natural language
2. **Type Safety**: Full TypeScript support prevents runtime errors
3. **Model Flexibility**: Mix and match AI models optimally
4. **Built-in Patterns**: Loops, conditions, parallel processing
5. **Production Ready**: Streaming, tracing, error handling included
6. **Resilience**: Built-in circuit breakers, retries, and fallback strategies ←
   **New!**
7. **Performance**: Concurrency control and resource-aware scheduling ← **New!**
8. **Enhanced Type Safety**: Explicit merge types for complex branching ←
   **New!**

### ✅ Best Practices Summary

1. **Start simple** - build incrementally
2. **Use aliases** (`.n()`, `.e()`, `.m()`) for concise code
3. **Choose models wisely** - fast for simple, powerful for complex
4. **Handle errors gracefully** - always have fallbacks and retries ←
   **Enhanced!**
5. **Keep state predictable** - avoid deep nesting
6. **Configure resilience** - use circuit breakers and retry strategies ←
   **New!**
7. **Optimize performance** - set concurrency limits and resource monitoring ←
   **New!**
8. **Use explicit types** - specify merge types for complex branches ← **New!**

### ✅ Common Gotchas to Avoid

- Executing nodes before declaring them
- Infinite loops without exit conditions
- Complex state mutations
- Missing error boundaries
- Over-engineering simple workflows

### 🚀 Next Steps

1. **Try the examples** in this guide
2. **Build your first workflow** with the quick start
3. **Optimize with MiPRO** (see OPTIMIZE.md)
4. **Add observability** for production deployment
5. **Share your patterns** with the community

**Ready to build the future of AI workflows?** AxFlow makes complex AI
orchestration simple, powerful, and production-ready. Start with the quick start
and build something amazing!

> _"AxFlow turns AI workflow complexity into poetry. What used to take hundreds
> of lines now takes dozens."_
