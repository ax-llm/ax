---
title: "AxRAG Guide"
description: "Advanced RAG with multi-hop retrieval and self-healing quality loops"
---

# Advanced RAG with AxFlow: `axRAG`

**`axRAG`** is a powerful, production-ready RAG (Retrieval-Augmented Generation) implementation built on AxFlow that provides advanced multi-hop retrieval, self-healing quality loops, and intelligent query refinement.

## Key Features

- **🔍 Multi-hop Retrieval**: Iteratively refines queries and accumulates context across multiple retrieval rounds
- **🧠 Intelligent Query Generation**: AI-powered query expansion and refinement based on previous context
- **🔄 Self-healing Quality Loops**: Automatically improves answers through quality assessment and iterative healing
- **⚡ Parallel Sub-query Processing**: Breaks down complex questions into parallel sub-queries for comprehensive coverage
- **🎯 Gap Analysis**: Identifies missing information and generates focused follow-up queries
- **🏥 Answer Healing**: Retrieves additional context to address quality issues and improve final answers
- **📊 Configurable Quality Thresholds**: Fine-tune performance vs. thoroughness trade-offs
- **🐛 Debug Mode**: Built-in logging to visualize the entire RAG pipeline execution

## Basic Usage

```typescript
import { AxAI, axRAG } from "@ax-llm/ax";

const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
});

// Your vector database query function
const queryVectorDB = async (query: string): Promise<string> => {
  // Connect to your vector database (Pinecone, Weaviate, etc.)
  // Return relevant context for the query
  return await yourVectorDB.query(query);
};

// Create a powerful RAG pipeline
const rag = axRAG(queryVectorDB, {
  maxHops: 3,           // Maximum retrieval iterations
  qualityThreshold: 0.8, // Quality score threshold (0-1)
  maxIterations: 2,      // Max parallel sub-query iterations
  qualityTarget: 0.85,   // Target quality for healing loops
  debug: true           // Enable detailed logging
});

// Execute RAG with complex question
const result = await rag.forward(llm, {
  originalQuestion: "How do machine learning algorithms impact privacy in financial services?"
});

console.log("Answer:", result.finalAnswer);
console.log("Quality:", result.qualityAchieved);
console.log("Sources:", result.retrievedContexts.length);
console.log("Hops:", result.totalHops);
console.log("Healing attempts:", result.healingAttempts);
```

## Advanced Configuration

```typescript
// Production-ready RAG with full configuration
const advancedRAG = axRAG(queryVectorDB, {
  // Multi-hop retrieval settings
  maxHops: 4,                    // More thorough retrieval
  qualityThreshold: 0.75,        // Lower threshold for faster execution
  
  // Parallel processing settings  
  maxIterations: 3,              // More sub-query iterations
  
  // Self-healing settings
  qualityTarget: 0.9,            // Higher quality target
  disableQualityHealing: false,  // Enable healing loops
  
  // Debug and monitoring
  debug: true,                   // Detailed execution logging
  logger: customLogger,          // Custom logging function
});

// Execute with complex research query
const result = await advancedRAG.forward(llm, {
  originalQuestion: "What are the latest developments in quantum computing for cryptography, including both opportunities and security risks?"
});
```

## RAG Pipeline Architecture

The `axRAG` implementation uses a sophisticated 4-phase approach:

**Phase 1: Multi-hop Context Retrieval**
- Generates intelligent search queries based on the original question
- Iteratively retrieves and contextualizes information
- Assesses completeness and refines queries for subsequent hops
- Accumulates comprehensive context across multiple retrieval rounds

**Phase 2: Parallel Sub-query Processing**
- Decomposes complex questions into focused sub-queries
- Executes parallel retrieval for comprehensive coverage
- Synthesizes evidence from multiple information sources
- Analyzes gaps and determines need for additional information

**Phase 3: Answer Generation**
- Generates comprehensive answers using accumulated context
- Leverages all retrieved information and synthesized evidence
- Produces initial high-quality responses

**Phase 4: Self-healing Quality Loops**
- Validates answer quality against configurable thresholds
- Identifies specific issues and areas for improvement
- Retrieves targeted healing context to address deficiencies
- Iteratively improves answers until quality targets are met

## AxFlow Pipeline Implementation

The `axRAG` implementation showcases the power of **AxFlow** to build complex, real-world LLM-powered pipelines that solve sophisticated problems. Below is the commented AxFlow pipeline code that demonstrates how intricate multi-hop RAG systems can be elegantly constructed using AxFlow's declarative approach:

```typescript
export const axRAG = (
  queryFn: (query: string) => Promise<string>,
  options?: {
    maxHops?: number;
    qualityThreshold?: number;
    maxIterations?: number;
    qualityTarget?: number;
    disableQualityHealing?: boolean;
    logger?: AxFlowLoggerFunction;
    debug?: boolean;
  }
) => {
  // Extract configuration with sensible defaults
  const maxHops = options?.maxHops ?? 3;
  const qualityThreshold = options?.qualityThreshold ?? 0.8;
  const maxIterations = options?.maxIterations ?? 2;
  const qualityTarget = options?.qualityTarget ?? 0.85;
  const disableQualityHealing = options?.disableQualityHealing ?? false;

  return (
    new AxFlow<
      { originalQuestion: string },
      {
        finalAnswer: string;
        totalHops: number;
        retrievedContexts: string[];
        iterationCount: number;
        healingAttempts: number;
        qualityAchieved: number;
      }
    >({
      logger: options?.logger,
      debug: options?.debug,
    })
      // 🏗️ STEP 1: Define AI-powered processing nodes
      // Each node represents a specialized AI task with typed inputs/outputs
      .node(
        'queryGenerator',
        'originalQuestion:string, previousContext?:string -> searchQuery:string, queryReasoning:string'
      )
      .node(
        'contextualizer',
        'retrievedDocument:string, accumulatedContext?:string -> enhancedContext:string'
      )
      .node(
        'qualityAssessor',
        'currentContext:string, originalQuestion:string -> completenessScore:number, missingAspects:string[]'
      )
      .node(
        'questionDecomposer',
        'complexQuestion:string -> subQuestions:string[], decompositionReason:string'
      )
      .node(
        'evidenceSynthesizer',
        'collectedEvidence:string[], originalQuestion:string -> synthesizedEvidence:string, evidenceGaps:string[]'
      )
      .node(
        'gapAnalyzer',
        'synthesizedEvidence:string, evidenceGaps:string[], originalQuestion:string -> needsMoreInfo:boolean, focusedQueries:string[]'
      )
      .node(
        'answerGenerator',
        'finalContext:string, originalQuestion:string -> comprehensiveAnswer:string, confidenceLevel:number'
      )
      .node(
        'queryRefiner',
        'originalQuestion:string, currentContext:string, missingAspects:string[] -> refinedQuery:string'
      )
      .node(
        'qualityValidator',
        'generatedAnswer:string, userQuery:string -> qualityScore:number, issues:string[]'
      )
      .node(
        'answerHealer',
        'originalAnswer:string, healingDocument:string, issues?:string[] -> healedAnswer:string'
      )

      // 🚀 STEP 2: Initialize comprehensive pipeline state
      // AxFlow maintains this state throughout the entire pipeline execution
      .map((state) => ({
        ...state,
        maxHops,
        qualityThreshold,
        maxIterations,
        qualityTarget,
        disableQualityHealing,
        currentHop: 0,
        accumulatedContext: '',
        retrievedContexts: [] as string[],
        completenessScore: 0,
        searchQuery: state.originalQuestion,
        shouldContinue: true,
        iteration: 0,
        allEvidence: [] as string[],
        evidenceSources: [] as string[],
        needsMoreInfo: true,
        healingAttempts: 0,
        currentQuality: 0,
        shouldContinueHealing: true,
        currentAnswer: '',
        currentIssues: [] as string[],
      }))

      // 🔄 PHASE 1: Multi-hop Retrieval with Iterative Refinement
      // AxFlow's .while() enables sophisticated looping with dynamic conditions
      .while(
        (state) =>
          state.currentHop < state.maxHops &&
          state.completenessScore < state.qualityThreshold &&
          state.shouldContinue
      )
      
      // Increment hop counter for each iteration
      .map((state) => ({
        ...state,
        currentHop: state.currentHop + 1,
      }))

      // 🧠 Generate intelligent search query using AI
      .execute('queryGenerator', (state) => ({
        originalQuestion: state.originalQuestion,
        previousContext: state.accumulatedContext || undefined,
      }))

      // 📚 Execute vector database retrieval using provided queryFn
      .map(async (state) => {
        const searchQuery = state.queryGeneratorResult.searchQuery as string;
        const retrievedDocument = await queryFn(searchQuery);
        return {
          ...state,
          retrievalResult: {
            retrievedDocument,
            retrievalConfidence: 0.9,
          },
        };
      })

      // 🔗 Contextualize retrieved document with existing knowledge
      .execute('contextualizer', (state) => ({
        retrievedDocument: state.retrievalResult.retrievedDocument,
        accumulatedContext: state.accumulatedContext || undefined,
      }))

      // 📊 Assess quality and completeness of current context
      .execute('qualityAssessor', (state) => ({
        currentContext: state.contextualizerResult.enhancedContext,
        originalQuestion: state.originalQuestion,
      }))

      // 📈 Update state with enhanced context and quality metrics
      .map((state) => ({
        ...state,
        accumulatedContext: state.contextualizerResult.enhancedContext,
        retrievedContexts: [
          ...state.retrievedContexts,
          state.retrievalResult.retrievedDocument,
        ],
        completenessScore: state.qualityAssessorResult.completenessScore as number,
        searchQuery: state.queryGeneratorResult.searchQuery as string,
        shouldContinue:
          (state.qualityAssessorResult.completenessScore as number) < state.qualityThreshold,
      }))

      // 🎯 Conditional query refinement using AxFlow's branching
      .branch(
        (state) => state.shouldContinue && state.currentHop < state.maxHops
      )
      .when(true)
      .execute('queryRefiner', (state) => ({
        originalQuestion: state.originalQuestion,
        currentContext: state.accumulatedContext,
        missingAspects: state.qualityAssessorResult.missingAspects,
      }))
      .map((state) => ({
        ...state,
        searchQuery: state.queryRefinerResult?.refinedQuery || state.searchQuery,
      }))
      .when(false)
      .map((state) => state) // No refinement needed
      .merge()

      .endWhile()

      // ⚡ PHASE 2: Advanced Parallel Sub-query Processing
      // Initialize evidence collection from Phase 1 results
      .map((state) => ({
        ...state,
        allEvidence: state.retrievedContexts.length > 0 ? state.retrievedContexts : [],
      }))

      // 🔄 Iterative sub-query processing loop
      .while(
        (state) => state.iteration < state.maxIterations && state.needsMoreInfo
      )
      .map((state) => ({
        ...state,
        iteration: state.iteration + 1,
      }))

      // 🧩 Question decomposition for first iteration
      .branch((state) => state.iteration === 1)
      .when(true)
      .execute('questionDecomposer', (state) => ({
        complexQuestion: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentQueries: state.questionDecomposerResult.subQuestions,
      }))
      .when(false)
      // Use focused queries from gap analysis for subsequent iterations
      .map((state) => ({
        ...state,
        currentQueries: ((state as any).gapAnalyzerResult?.focusedQueries as string[]) || [],
      }))
      .merge()

      // 🚀 Parallel retrieval execution for multiple queries
      .map(async (state) => {
        const queries = state.currentQueries || [];
        const retrievalResults =
          queries.length > 0
            ? await Promise.all(queries.map((query: string) => queryFn(query)))
            : [];
        return {
          ...state,
          retrievalResults,
        };
      })

      // 🧪 Synthesize evidence from multiple sources
      .execute('evidenceSynthesizer', (state) => {
        const evidence = [
          ...(state.allEvidence || []),
          ...(state.retrievalResults || []),
        ].filter(Boolean);

        return {
          collectedEvidence: evidence.length > 0 ? evidence : ['No evidence collected yet'],
          originalQuestion: state.originalQuestion,
        };
      })

      // 🔍 Analyze information gaps and determine next steps
      .execute('gapAnalyzer', (state) => ({
        synthesizedEvidence: state.evidenceSynthesizerResult.synthesizedEvidence,
        evidenceGaps: state.evidenceSynthesizerResult.evidenceGaps,
        originalQuestion: state.originalQuestion,
      }))

      // 📊 Update state with synthesized evidence and gap analysis
      .map((state) => ({
        ...state,
        allEvidence: [...state.allEvidence, ...state.retrievalResults],
        evidenceSources: [...state.evidenceSources, `Iteration ${state.iteration} sources`],
        needsMoreInfo: state.gapAnalyzerResult.needsMoreInfo,
        synthesizedEvidence: state.evidenceSynthesizerResult.synthesizedEvidence,
      }))

      .endWhile()

      // 📝 PHASE 3: Generate comprehensive initial answer
      .execute('answerGenerator', (state) => ({
        finalContext:
          state.accumulatedContext ||
          state.synthesizedEvidence ||
          state.allEvidence.join('\n'),
        originalQuestion: state.originalQuestion,
      }))

      // 🏥 PHASE 4: Self-healing Quality Validation and Improvement
      // Conditional quality healing based on configuration
      .branch((state) => !state.disableQualityHealing)
      .when(true)
      
      // Validate initial answer quality
      .execute('qualityValidator', (state) => ({
        generatedAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        userQuery: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult.comprehensiveAnswer as string,
        currentQuality: state.qualityValidatorResult.qualityScore as number,
        currentIssues: state.qualityValidatorResult.issues as string[],
        shouldContinueHealing:
          (state.qualityValidatorResult.qualityScore as number) < state.qualityTarget,
      }))

      // 🔄 Healing loop for iterative quality improvement
      .while(
        (state) => state.healingAttempts < 3 && state.shouldContinueHealing
      )
      .map((state) => ({
        ...state,
        healingAttempts: state.healingAttempts + 1,
      }))

      // 🩹 Retrieve healing context to address specific issues
      .map(async (state) => {
        const healingQuery = `${state.originalQuestion} addressing issues: ${(state.currentIssues as string[])?.join(', ') || 'quality improvement'}`;
        const healingDocument = await queryFn(healingQuery);
        return {
          ...state,
          healingResult: { healingDocument },
        };
      })

      // 🔧 Apply healing to improve answer quality
      .execute('answerHealer', (state) => ({
        originalAnswer: state.currentAnswer,
        healingDocument: state.healingResult.healingDocument,
        issues: state.currentIssues,
      }))

      // ✅ Re-validate after healing application
      .execute('qualityValidator', (state) => ({
        generatedAnswer: state.answerHealerResult.healedAnswer,
        userQuery: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: state.answerHealerResult.healedAnswer as string,
        currentQuality: state.qualityValidatorResult.qualityScore as number,
        currentIssues: state.qualityValidatorResult.issues as string[],
        shouldContinueHealing:
          (state.qualityValidatorResult.qualityScore as number) < state.qualityTarget,
      }))

      .endWhile()
      .when(false)
      // Skip quality healing - use answer directly from Phase 3
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        currentQuality: 1.0, // Assume perfect quality when disabled
        currentIssues: [] as string[],
        shouldContinueHealing: false,
      }))
      .merge()

      // 🎯 Final output transformation
      .map((state) => ({
        finalAnswer: state.currentAnswer,
        totalHops: state.currentHop,
        retrievedContexts: state.retrievedContexts,
        iterationCount: state.iteration,
        healingAttempts: state.healingAttempts,
        qualityAchieved: state.currentQuality,
      }))
  );
};
```

### 🌟 Why This Demonstrates AxFlow's Power

This `axRAG` implementation showcases **AxFlow's unique capabilities** for building enterprise-grade LLM pipelines:

**🏗️ Complex State Management**: AxFlow seamlessly manages complex state transformations across 20+ pipeline steps, handling async operations, branching logic, and iterative loops without losing state consistency.

**🔄 Advanced Control Flow**: The pipeline uses AxFlow's `.while()`, `.branch()`, `.when()`, and `.merge()` operators to implement sophisticated control flow that would be complex and error-prone with traditional code.

**⚡ Automatic Parallelization**: AxFlow automatically parallelizes operations where possible, such as the parallel sub-query processing in Phase 2, maximizing performance without manual coordination.

**🧠 AI-Native Design**: Each `.node()` defines an AI task with typed signatures, making the pipeline self-documenting and enabling automatic prompt optimization and validation.

**🛡️ Production Reliability**: Built-in error handling, retry logic, state recovery, and comprehensive logging make this production-ready for real-world applications.

**📊 Observability**: The debug mode and logging capabilities provide complete visibility into the pipeline execution, essential for debugging and optimization.

This level of sophistication—multi-hop reasoning, self-healing quality loops, parallel processing, and intelligent branching—demonstrates how **AxFlow enables developers to build the kinds of advanced LLM systems that solve real-world problems** with enterprise reliability and maintainability.

## Debug Mode Visualization

Enable `debug: true` to see the complete RAG pipeline execution:

```bash
🔄 [ AXFLOW START ]
Input Fields: originalQuestion
Total Steps: 18
═══════════════════════════════════════

⚡ [ STEP 3 EXECUTE ] Node: contextualizer in 1.62s
New Fields: contextualizerResult
Result: {
  "enhancedContext": "Machine learning in financial services raises privacy concerns through data collection, algorithmic bias, and potential for discrimination. Regulations like GDPR require explicit consent and data protection measures."
}
────────────────────────────────────────

⚡ [ STEP 9 EXECUTE ] Node: evidenceSynthesizer in 1.42s  
New Fields: evidenceSynthesizerResult
Result: {
  "synthesizedEvidence": "Comprehensive analysis of ML privacy implications including regulatory compliance, bias prevention, and consumer protection measures.",
  "evidenceGaps": ["Technical implementation details", "Industry-specific case studies"]
}
────────────────────────────────────────

✅ [ AXFLOW COMPLETE ]
Total Time: 12.49s
Steps Executed: 15
═══════════════════════════════════════
```

## Integration with Vector Databases

```typescript
// Weaviate integration
import { axDB } from "@ax-llm/ax";

const weaviateDB = new axDB("weaviate", {
  url: "http://localhost:8080",
});

const queryWeaviate = async (query: string): Promise<string> => {
  const embedding = await llm.embed({ texts: [query] });
  const results = await weaviateDB.query({
    table: "documents",
    values: embedding.embeddings[0],
    limit: 5,
  });
  return results.map(r => r.metadata.text).join('\n');
};

// Pinecone integration  
import { axDB } from "@ax-llm/ax";

const pineconeDB = new axDB("pinecone", {
  apiKey: process.env.PINECONE_API_KEY,
  environment: "us-west1-gcp",
});

const queryPinecone = async (query: string): Promise<string> => {
  const embedding = await llm.embed({ texts: [query] });
  const results = await pineconeDB.query({
    table: "knowledge-base",
    values: embedding.embeddings[0],
    topK: 10,
  });
  return results.matches.map(m => m.metadata.content).join('\n');
};
```

## Performance Optimization

```typescript
// Optimized for speed
const fastRAG = axRAG(queryFn, {
  maxHops: 2,              // Fewer hops for speed
  qualityThreshold: 0.7,   // Lower quality threshold
  maxIterations: 1,        // Single iteration
  disableQualityHealing: true, // Skip healing for speed
});

// Optimized for quality
const qualityRAG = axRAG(queryFn, {
  maxHops: 5,              // Thorough retrieval
  qualityThreshold: 0.9,   // High quality threshold  
  maxIterations: 3,        // Multiple iterations
  qualityTarget: 0.95,     // Very high healing target
  disableQualityHealing: false,
});

// Balanced configuration
const balancedRAG = axRAG(queryFn, {
  maxHops: 3,
  qualityThreshold: 0.8,
  maxIterations: 2,
  qualityTarget: 0.85,
});
```

## Simple RAG Alternative

For basic use cases, `axRAG` also provides `axSimpleRAG`:

```typescript
import { axSimpleRAG } from "@ax-llm/ax";

// Simple single-hop RAG
const simpleRAG = axSimpleRAG(queryVectorDB);

const result = await simpleRAG.forward(llm, {
  question: "What is renewable energy?"
});

console.log("Answer:", result.answer);
console.log("Context:", result.context);
```

## Why axRAG is Powerful

**🚀 Production-Ready Architecture:**
- Built on AxFlow's automatic parallelization and resilience features
- Self-healing quality loops prevent poor answers
- Configurable trade-offs between speed and thoroughness
- Comprehensive logging and debugging capabilities

**🧠 Advanced Intelligence:**
- Multi-hop reasoning that builds context iteratively
- Intelligent query refinement based on previous results
- Gap analysis to identify missing information
- Parallel sub-query processing for complex questions

**🔧 Enterprise Features:**
- Configurable quality thresholds and targets
- Support for any vector database through simple query function
- Built-in error handling and retry logic
- Comprehensive metrics and observability

**⚡ Performance Optimized:**
- Automatic parallelization where possible
- Intelligent caching and context reuse
- Configurable performance vs. quality trade-offs
- Efficient token usage through smart prompt management

> _"axRAG doesn't just retrieve and generate—it thinks, analyzes, and iteratively improves to deliver the highest quality answers possible"_

The `axRAG` function represents the future of RAG systems: intelligent, self-improving, and production-ready with enterprise-grade reliability built on AxFlow's powerful orchestration capabilities.