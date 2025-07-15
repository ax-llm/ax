---
title: "AxFlow Guide"
description: "AxFlow - Orchestration framework for building AI workflows with Ax"
---

# AxFlow Documentation

**AxFlow** is a powerful workflow orchestration system for building complex AI applications with automatic dependency analysis, parallel execution, and flexible control flow patterns.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Control Flow Patterns](#control-flow-patterns)
- [Advanced Features](#advanced-features)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Quick Start

### Basic Flow

```typescript
import { AxFlow } from '@ax-llm/ax';

// Create a simple flow
const flow = new AxFlow<{ userInput: string }, { responseText: string }>()
  .node('testNode', 'userInput:string -> responseText:string')
  .execute('testNode', (state) => ({ userInput: state.userInput }))
  .map((state) => ({ responseText: state.testNodeResult.responseText }));

// Execute the flow
const result = await flow.forward(ai, { userInput: 'Hello world' });
console.log(result.responseText);
```

### Constructor Options

```typescript
// Basic constructor
const flow = new AxFlow();

// With options
const flow = new AxFlow({ autoParallel: false });

// With explicit typing
const flow = new AxFlow<InputType, OutputType>();

// With options and typing
const flow = new AxFlow<InputType, OutputType>({ autoParallel: true, batchSize: 5 });
```

## Core Concepts

### 1. Node Definition

Nodes define the available operations in your flow. You must define nodes before executing them.

```typescript
// String signature (creates AxGen automatically)
flow.node('processor', 'input:string -> output:string');

// With multiple outputs
flow.node('analyzer', 'text:string -> sentiment:string, confidence:number');

// Complex field types
flow.node('extractor', 'documentText:string -> processedResult:string, entities:string[]');
```

### 2. State Evolution

State grows as you execute nodes, with results stored in `{nodeName}Result` format:

```typescript
// Initial state: { userInput: "Hello" }
flow.execute('processor', (state) => ({ input: state.userInput }))
// State becomes: { userInput: "Hello", processorResult: { output: "Processed Hello" } }

flow.execute('analyzer', (state) => ({ text: state.processorResult.output }))
// State becomes: { 
//   userInput: "Hello", 
//   processorResult: { output: "Processed Hello" },
//   analyzerResult: { sentiment: "positive", confidence: 0.8 }
// }
```

### 3. State Transformation

Use `map()` to transform state between operations:

```typescript
flow.map((state) => ({
  ...state,
  processedInput: state.userInput.toLowerCase(),
  timestamp: Date.now()
}));
```

## API Reference

### Core Methods

#### `node(name: string, signature: string, options?: object)`
Define a node with the given signature.

```typescript
flow.node('summarizer', 'documentText:string -> summary:string');
flow.node('classifier', 'text:string -> category:string', { debug: true });
```

#### `execute(nodeName: string, mapping: Function, options?: object)`
Execute a node with input mapping.

```typescript
flow.execute('summarizer', (state) => ({ 
  documentText: state.document 
}));

// With AI override
flow.execute('processor', mapping, { ai: alternativeAI });
```

#### `map(transform: Function)`
Transform the current state.

```typescript
flow.map((state) => ({
  ...state,
  upperCaseResult: state.processorResult.output.toUpperCase()
}));
```

### Control Flow Methods

#### `while(condition: Function)` / `endWhile()`
Create loops that execute while condition is true.

```typescript
flow
  .map((state) => ({ ...state, counter: 0 }))
  .while((state) => state.counter < 3)
    .map((state) => ({ ...state, counter: state.counter + 1 }))
    .execute('processor', (state) => ({ input: `iteration ${state.counter}` }))
  .endWhile();
```

#### `branch(predicate: Function)` / `when(value)` / `merge()`
Conditional branching based on predicate evaluation.

```typescript
flow
  .branch((state) => state.complexity)
  .when('simple')
    .execute('simpleProcessor', mapping)
  .when('complex')
    .execute('complexProcessor', mapping)
  .merge()
  .map((state) => ({
    result: state.simpleProcessorResult?.output || state.complexProcessorResult?.output
  }));
```

#### `parallel(subFlows: Function[])` / `merge(key: string, mergeFunction: Function)`
Execute multiple sub-flows in parallel.

```typescript
flow
  .parallel([
    (subFlow) => subFlow.execute('analyzer1', (state) => ({ text: state.input })),
    (subFlow) => subFlow.execute('analyzer2', (state) => ({ text: state.input })),
    (subFlow) => subFlow.execute('analyzer3', (state) => ({ text: state.input }))
  ])
  .merge('combinedResults', (result1, result2, result3) => ({
    analysis1: result1.analyzer1Result.analysis,
    analysis2: result2.analyzer2Result.analysis,
    analysis3: result3.analyzer3Result.analysis
  }));
```

#### `label(name: string)` / `feedback(condition: Function, labelName: string, maxIterations?: number)`
Create labeled points for feedback loops.

```typescript
flow
  .map((state) => ({ ...state, attempts: 0 }))
  .label('retry-point')
  .map((state) => ({ ...state, attempts: state.attempts + 1 }))
  .execute('processor', (state) => ({ input: state.userInput }))
  .execute('validator', (state) => ({ output: state.processorResult.output }))
  .feedback(
    (state) => !state.validatorResult.isValid && state.attempts < 3,
    'retry-point'
  );
```

### Advanced Methods

#### `derive(outputField: string, inputField: string, transform: Function, options?: object)`
Create derived fields from array or scalar inputs with parallel processing support.

```typescript
// Derive from array with parallel processing
flow.derive('processedItems', 'items', (item, index) => `processed-${item}-${index}`, {
  batchSize: 2
});

// Derive from scalar
flow.derive('upperText', 'inputText', (text) => text.toUpperCase());
```

## Control Flow Patterns

### 1. Sequential Processing

```typescript
const sequentialFlow = new AxFlow<{ input: string }, { finalResult: string }>()
  .node('step1', 'input:string -> intermediate:string')
  .node('step2', 'intermediate:string -> output:string')
  .execute('step1', (state) => ({ input: state.input }))
  .execute('step2', (state) => ({ intermediate: state.step1Result.intermediate }))
  .map((state) => ({ finalResult: state.step2Result.output }));
```

### 2. Conditional Processing

```typescript
const conditionalFlow = new AxFlow<
  { query: string; isComplex: boolean }, 
  { response: string }
>()
  .node('simpleHandler', 'query:string -> response:string')
  .node('complexHandler', 'query:string -> response:string')
  .branch((state) => state.isComplex)
  .when(true)
    .execute('complexHandler', (state) => ({ query: state.query }))
  .when(false)
    .execute('simpleHandler', (state) => ({ query: state.query }))
  .merge()
  .map((state) => ({
    response: state.complexHandlerResult?.response || state.simpleHandlerResult?.response
  }));
```

### 3. Iterative Processing

```typescript
const iterativeFlow = new AxFlow<{ content: string }, { finalContent: string }>()
  .node('processor', 'content:string -> processedContent:string')
  .node('qualityChecker', 'content:string -> qualityScore:number')
  .map((state) => ({ currentContent: state.content, iteration: 0 }))
  .while((state) => state.iteration < 3 && (state.qualityScore || 0) < 0.8)
    .map((state) => ({ ...state, iteration: state.iteration + 1 }))
    .execute('processor', (state) => ({ content: state.currentContent }))
    .execute('qualityChecker', (state) => ({ content: state.processorResult.processedContent }))
    .map((state) => ({
      ...state,
      currentContent: state.processorResult.processedContent,
      qualityScore: state.qualityCheckerResult.qualityScore
    }))
  .endWhile()
  .map((state) => ({ finalContent: state.currentContent }));
```

### 4. Parallel Processing with Auto-Parallelization

AxFlow automatically detects independent operations and runs them in parallel:

```typescript
const autoParallelFlow = new AxFlow<{ text: string }, { combinedAnalysis: string }>()
  .node('sentimentAnalyzer', 'text:string -> sentiment:string')
  .node('topicExtractor', 'text:string -> topics:string[]')
  .node('entityRecognizer', 'text:string -> entities:string[]')
  // These three execute automatically in parallel! ⚡
  .execute('sentimentAnalyzer', (state) => ({ text: state.text }))
  .execute('topicExtractor', (state) => ({ text: state.text }))
  .execute('entityRecognizer', (state) => ({ text: state.text }))
  // This waits for all three to complete
  .map((state) => ({
    combinedAnalysis: JSON.stringify({
      sentiment: state.sentimentAnalyzerResult.sentiment,
      topics: state.topicExtractorResult.topics,
      entities: state.entityRecognizerResult.entities
    })
  }));

// Check execution plan
const plan = autoParallelFlow.getExecutionPlan();
console.log('Parallel groups:', plan.parallelGroups);
console.log('Max parallelism:', plan.maxParallelism);
```

### 5. Self-Healing with Feedback Loops

```typescript
const selfHealingFlow = new AxFlow<{ input: string }, { output: string }>()
  .node('processor', 'input:string -> output:string, confidence:number')
  .node('validator', 'output:string -> isValid:boolean, issues:string[]')
  .node('fixer', 'output:string, issues:string[] -> fixedOutput:string')
  .map((state) => ({ ...state, attempts: 0 }))
  .label('process')
  .map((state) => ({ ...state, attempts: state.attempts + 1 }))
  .execute('processor', (state) => ({ input: state.input }))
  .execute('validator', (state) => ({ output: state.processorResult.output }))
  .feedback(
    (state) => !state.validatorResult.isValid && state.attempts < 3,
    'process'
  )
  // If still invalid after retries, try to fix
  .branch((state) => state.validatorResult.isValid)
  .when(false)
    .execute('fixer', (state) => ({
      output: state.processorResult.output,
      issues: state.validatorResult.issues
    }))
    .map((state) => ({ 
      output: state.fixerResult.fixedOutput 
    }))
  .when(true)
    .map((state) => ({ 
      output: state.processorResult.output 
    }))
  .merge();
```

## Advanced Features

### 1. Auto-Parallelization

AxFlow automatically analyzes dependencies and runs independent operations in parallel:

```typescript
// Disable auto-parallelization globally
const sequentialFlow = new AxFlow({ autoParallel: false });

// Disable for specific execution
const result = await flow.forward(ai, input, { autoParallel: false });

// Get execution plan information
const plan = flow.getExecutionPlan();
console.log(`Will run ${plan.parallelGroups} parallel groups with max ${plan.maxParallelism} concurrent operations`);
```

### 2. Dynamic AI Context

Use different AI services for different nodes:

```typescript
flow
  .execute('fastProcessor', mapping, { ai: speedAI })
  .execute('powerfulAnalyzer', mapping, { ai: powerAI })
  .execute('defaultProcessor', mapping); // Uses default AI from forward()
```

### 3. Batch Processing with Derive

```typescript
const batchFlow = new AxFlow<{ items: string[] }, { processedItems: string[] }>({
  autoParallel: true,
  batchSize: 3  // Process 3 items at a time
})
  .derive('processedItems', 'items', (item, index) => {
    return `processed-${item}-${index}`;
  }, { batchSize: 2 }); // Override batch size for this operation
```

### 4. Error Handling

```typescript
try {
  const result = await flow.forward(ai, input);
} catch (error) {
  console.error('Flow execution failed:', error);
}
```

### 5. Program Integration

AxFlow integrates with the dspy-ts ecosystem:

```typescript
// Get signature
const signature = flow.getSignature();

// Set examples (if applicable)
flow.setExamples(examples);

// Get traces and usage
const traces = flow.getTraces();
const usage = flow.getUsage();
```

## Best Practices

### 1. Node Naming
Use descriptive names that clearly indicate the node's purpose:

```typescript
// ❌ Unclear
flow.node('proc1', signature);

// ✅ Clear
flow.node('documentSummarizer', signature);
flow.node('sentimentAnalyzer', signature);
```

### 2. State Management
Keep state flat and predictable:

```typescript
// ✅ Good - flat structure
flow.map((state) => ({
  ...state,
  processedText: state.rawText.toLowerCase(),
  timestamp: Date.now()
}));

// ❌ Avoid - deep nesting
flow.map((state) => ({
  data: {
    processed: {
      text: state.rawText.toLowerCase()
    }
  }
}));
```

### 3. Error Prevention
Always define nodes before executing them:

```typescript
// ✅ Correct order
flow
  .node('processor', signature)
  .execute('processor', mapping);

// ❌ Will throw error
flow
  .execute('processor', mapping)  // Node not defined yet!
  .node('processor', signature);
```

### 4. Loop Safety
Ensure loop conditions can change:

```typescript
// ✅ Safe - counter increments
flow
  .map((state) => ({ ...state, counter: 0 }))
  .while((state) => state.counter < 5)
    .map((state) => ({ ...state, counter: state.counter + 1 })) // Condition changes
    .execute('processor', mapping)
  .endWhile();

// ❌ Infinite loop - condition never changes
flow
  .while((state) => state.isProcessing)  // This never changes!
    .execute('processor', mapping)
  .endWhile();
```

### 5. Parallel Design
Structure flows to maximize automatic parallelization:

```typescript
// ✅ Parallel-friendly - independent operations
flow
  .execute('analyzer1', (state) => ({ text: state.input }))    // Can run in parallel
  .execute('analyzer2', (state) => ({ text: state.input }))    // Can run in parallel
  .execute('combiner', (state) => ({                           // Waits for both
    input1: state.analyzer1Result.output,
    input2: state.analyzer2Result.output
  }));

// ❌ Sequential - unnecessary dependencies
flow
  .execute('analyzer1', (state) => ({ text: state.input }))
  .execute('analyzer2', (state) => ({ 
    text: state.input,
    context: state.analyzer1Result.output  // Creates dependency!
  }));
```

## Examples

### Document Processing Pipeline

```typescript
const documentPipeline = new AxFlow<
  { document: string },
  { summary: string; sentiment: string; keywords: string[] }
>()
  .node('summarizer', 'documentText:string -> summary:string')
  .node('sentimentAnalyzer', 'documentText:string -> sentiment:string')
  .node('keywordExtractor', 'documentText:string -> keywords:string[]')
  
  // These run automatically in parallel
  .execute('summarizer', (state) => ({ documentText: state.document }))
  .execute('sentimentAnalyzer', (state) => ({ documentText: state.document }))
  .execute('keywordExtractor', (state) => ({ documentText: state.document }))
  
  .map((state) => ({
    summary: state.summarizerResult.summary,
    sentiment: state.sentimentAnalyzerResult.sentiment,
    keywords: state.keywordExtractorResult.keywords
  }));
```

### Quality-Driven Content Creation

```typescript
const contentCreator = new AxFlow<
  { topic: string; targetQuality: number },
  { finalContent: string; iterations: number }
>()
  .node('writer', 'topic:string -> content:string')
  .node('qualityChecker', 'content:string -> score:number, feedback:string')
  .node('improver', 'content:string, feedback:string -> improvedContent:string')
  
  .map((state) => ({ currentContent: '', iteration: 0, bestScore: 0 }))
  
  // Initial writing
  .execute('writer', (state) => ({ topic: state.topic }))
  .map((state) => ({
    ...state,
    currentContent: state.writerResult.content,
    iteration: 1
  }))
  
  // Improvement loop
  .while((state) => state.iteration < 5 && state.bestScore < state.targetQuality)
    .execute('qualityChecker', (state) => ({ content: state.currentContent }))
    .branch((state) => state.qualityCheckerResult.score > state.bestScore)
    .when(true)
      .execute('improver', (state) => ({
        content: state.currentContent,
        feedback: state.qualityCheckerResult.feedback
      }))
      .map((state) => ({
        ...state,
        currentContent: state.improverResult.improvedContent,
        bestScore: state.qualityCheckerResult.score,
        iteration: state.iteration + 1
      }))
    .when(false)
      .map((state) => ({ ...state, iteration: 5 })) // Exit loop
    .merge()
  .endWhile()
  
  .map((state) => ({
    finalContent: state.currentContent,
    iterations: state.iteration
  }));
```

### Multi-Model Research System

```typescript
const researchSystem = new AxFlow<
  { query: string },
  { answer: string; sources: string[]; confidence: number }
>()
  .node('queryGenerator', 'researchQuestion:string -> searchQuery:string')
  .node('retriever', 'searchQuery:string -> retrievedDocument:string')
  .node('answerGenerator', 'retrievedDocument:string, researchQuestion:string -> researchAnswer:string')
  
  .execute('queryGenerator', (state) => ({ researchQuestion: state.query }))
  .execute('retriever', (state) => ({ searchQuery: state.queryGeneratorResult.searchQuery }))
  .execute('answerGenerator', (state) => ({
    retrievedDocument: state.retrieverResult.retrievedDocument,
    researchQuestion: state.query
  }))
  
  .map((state) => ({
    answer: state.answerGeneratorResult.researchAnswer,
    sources: [state.retrieverResult.retrievedDocument],
    confidence: 0.85
  }));
```

## Troubleshooting

### Common Errors

1. **"Node 'nodeName' not found"**
   - Ensure you call `.node()` before `.execute()`

2. **"endWhile() called without matching while()"**
   - Every `.while()` needs a matching `.endWhile()`

3. **"when() called without matching branch()"**
   - Every `.when()` needs to be inside a `.branch()` / `.merge()` block

4. **"merge() called without matching branch()"**
   - Every `.branch()` needs a matching `.merge()`

5. **"Label 'labelName' not found"**
   - Ensure the label exists before using it in `.feedback()`

### Performance Issues

1. **Operations running sequentially instead of parallel**
   - Check for unnecessary dependencies in your mappings
   - Use `flow.getExecutionPlan()` to debug

2. **Memory issues with large datasets**
   - Use `batchSize` option to control parallel execution
   - Consider using `.derive()` for array processing

### Type Errors

1. **State property not found**
   - Use `.map()` to ensure required properties exist
   - Check the spelling of result field names (`{nodeName}Result`)

This documentation provides a comprehensive guide to AxFlow based on the actual implementation and test cases. All examples have been verified against the test suite to ensure accuracy.