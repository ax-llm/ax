/* eslint-disable @typescript-eslint/no-explicit-any */
// Example: Multi-Model Flow with AxFlow
// This example demonstrates the AxFlow API for building complex, stateful AI programs
// with different AI models for different tasks.

import { AxAI, AxFlow } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
})

// Example 1: Basic Flow with Conditional Branching
console.log('=== Example 1: Conditional Branching ===')

const branchingFlow = new AxFlow<
  { userQuery: string },
  { finalAnswer: string; strategy: string }
>('userQuery:string -> finalAnswer:string, strategy:string')
  .node(
    'qualityCheck',
    'query:string -> needsMoreInfo:boolean, confidence:number'
  )
  .node('simpleAnswer', 'query:string -> answer:string')
  .node('detailedResearch', 'query:string -> researchData:string')
  .node('complexAnswer', 'query:string, research:string -> answer:string')

  .execute('qualityCheck', (state) => ({ query: state.userQuery }))
  .branch((state) => state.qualityCheckResult.needsMoreInfo)
  .when(true)
  .execute('detailedResearch', (state) => ({ query: state.userQuery }))
  .execute('complexAnswer', (state) => ({
    query: state.userQuery,
    research: state.detailedResearchResult.researchData,
  }))
  .map((state) => ({
    ...state,
    finalAnswer: state.complexAnswerResult.answer,
    strategy: 'detailed_research',
  }))
  .when(false)
  .execute('simpleAnswer', (state) => ({ query: state.userQuery }))
  .map((state) => ({
    ...state,
    finalAnswer: state.simpleAnswerResult.answer,
    strategy: 'simple_answer',
  }))
  .merge()

const branchResult = await branchingFlow.forward(ai, {
  userQuery: "What's the capital of France?",
})
console.log('Branching result:', branchResult)

// Example 2: Parallel Execution
console.log('\n=== Example 2: Parallel Execution ===')

const parallelFlow = new AxFlow<
  { topic: string },
  { combinedInsights: string[] }
>('topic:string -> combinedInsights:string[]')
  .node('historicalAnalysis', 'topic:string -> analysis:string')
  .node('currentTrends', 'topic:string -> trends:string')
  .node('futureOutlook', 'topic:string -> outlook:string')

  .parallel([
    (subFlow: any) =>
      subFlow.execute('historicalAnalysis', (state: any) => ({
        topic: state.topic,
      })),
    (subFlow: any) =>
      subFlow.execute('currentTrends', (state: any) => ({
        topic: state.topic,
      })),
    (subFlow: any) =>
      subFlow.execute('futureOutlook', (state: any) => ({
        topic: state.topic,
      })),
  ])
  .merge('combinedInsights', (historical: any, current: any, future: any) => [
    historical.historicalAnalysisResult.analysis,
    current.currentTrendsResult.trends,
    future.futureOutlookResult.outlook,
  ])

const parallelResult = await parallelFlow.forward(ai, {
  topic: 'artificial intelligence',
})
console.log('Parallel result:', parallelResult)

// Example 3: Feedback Loops
console.log('\n=== Example 3: Feedback Loops ===')

const feedbackFlow = new AxFlow<
  { question: string },
  { finalAnswer: string; iterations: number }
>('question:string -> finalAnswer:string, iterations:number')
  .node('generateAnswer', 'question:string, attempt:number -> answer:string')
  .node(
    'evaluateQuality',
    'answer:string -> confidence:number, needsImprovement:boolean'
  )

  .map((state) => ({ ...state, attempt: 1 }))
  .label('retry-point')
  .execute('generateAnswer', (state) => ({
    question: state.question,
    attempt: state.attempt || 1,
  }))
  .execute('evaluateQuality', (state) => ({
    answer: state.generateAnswerResult.answer,
  }))
  .map((state) => ({
    ...state,
    attempt: (state.attempt || 1) + 1,
  }))
  .feedback(
    (state) =>
      ((state.evaluateQualityResult?.confidence as number) || 0) < 0.7 &&
      (state.attempt || 1) < 4,
    'retry-point'
  )
  .map((state) => ({
    finalAnswer: state.generateAnswerResult.answer,
    iterations: state.attempt || 1,
  }))

const feedbackResult = await feedbackFlow.forward(ai, {
  question: 'Explain quantum computing in simple terms',
})
console.log('Feedback result:', feedbackResult)

// Example 4: Complex Combined Flow
console.log('\n=== Example 4: Complex Combined Flow ===')

const complexFlow = new AxFlow<
  { userRequest: string },
  {
    responseText: string
    metadata: { strategy: string; sources: number; confidence: number }
  }
>('userRequest:string -> responseText:string, metadata:json')
  .node(
    'intentClassifier',
    'userQuery:string -> intent:string, complexity:number'
  )
  .node('quickAnswer', 'userQuery:string -> answer:string')
  .node('researcher1', 'userQuery:string -> findings:string')
  .node('researcher2', 'userQuery:string -> findings:string')
  .node('synthesizer', 'userQuery:string, sources:string[] -> answer:string')
  .node('qualityChecker', 'answer:string -> confidence:number')

  .execute('intentClassifier', (state) => ({ userQuery: state.userRequest }))

  // Branch based on complexity
  .branch(
    (state) => ((state.intentClassifierResult?.complexity as number) || 0) > 0.7
  )
  .when(true)
  // Complex request - use parallel research
  .parallel([
    (subFlow: any) =>
      subFlow.execute('researcher1', (state: any) => ({
        userQuery: state.userRequest,
      })),
    (subFlow: any) =>
      subFlow.execute('researcher2', (state: any) => ({
        userQuery: state.userRequest,
      })),
  ])
  .merge('researchFindings', (findings1, findings2) => [
    (findings1 as any).researcher1Result.findings,
    (findings2 as any).researcher2Result.findings,
  ])
  .execute('synthesizer', (state) => ({
    userQuery: state.userRequest,
    sources: state.researchFindings,
  }))
  .map((state) => ({
    ...state,
    strategy: 'research_synthesis',
    sourceCount: 2,
  }))
  .when(false)
  // Simple request - quick answer
  .execute('quickAnswer', (state) => ({ userQuery: state.userRequest }))
  .map((state) => ({
    ...state,
    synthesizerResult: { answer: state.quickAnswerResult.answer },
    strategy: 'quick_answer',
    sourceCount: 0,
  }))
  .merge()

  // Quality check with feedback loop
  .label('quality-check')
  .execute('qualityChecker', (state) => ({
    answer: state.synthesizerResult.answer,
  }))
  .feedback(
    (state) => ((state.qualityCheckerResult?.confidence as number) || 0) < 0.6,
    'quality-check'
  )

  // Final mapping
  .map((state) => ({
    responseText: state.synthesizerResult.answer,
    metadata: {
      strategy: state.strategy,
      sources: state.sourceCount,
      confidence: state.qualityCheckerResult.confidence,
    },
  }))

const complexResult = await complexFlow.forward(ai, {
  userRequest:
    'What are the latest developments in renewable energy technology?',
})
console.log('Complex result:', complexResult)

// Example 5: Loop with Branching
console.log('\n=== Example 5: Loop with Branching ===')

const loopBranchFlow = new AxFlow<
  { items: string[] },
  { processedItems: string[]; totalProcessed: number }
>('items:string[] -> processedItems:string[], totalProcessed:number')
  .node('processor', 'itemText:string, method:string -> processedItem:string')
  .node('complexityChecker', 'itemText:string -> isComplex:boolean')

  .map((state) => ({
    ...state,
    processedItems: [],
    currentIndex: 0,
  }))

  .while((state) => state.currentIndex < state.items.length)
  .map((state) => ({
    ...state,
    currentItem: state.items[state.currentIndex],
  }))
  .execute('complexityChecker', (state) => ({ itemText: state.currentItem }))
  .branch((state) => state.complexityCheckerResult.isComplex)
  .when(true)
  .execute('processor', (state) => ({
    itemText: state.currentItem,
    method: 'complex',
  }))
  .when(false)
  .execute('processor', (state) => ({
    itemText: state.currentItem,
    method: 'simple',
  }))
  .merge()
  .map((state) => ({
    ...state,
    processedItems: [
      ...state.processedItems,
      state.processorResult.processedItem,
    ],
    currentIndex: state.currentIndex + 1,
  }))
  .endWhile()

  .map((state) => ({
    processedItems: state.processedItems,
    totalProcessed: state.processedItems.length,
  }))

const loopBranchResult = await loopBranchFlow.forward(ai, {
  items: ['apple', 'quantum computer', 'book', 'artificial intelligence'],
})
console.log('Loop with branching result:', loopBranchResult)
