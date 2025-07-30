import { flow } from '../ax/index.js';

// Example usage of the fluent flow API
console.log('=== Fluent Flow API Example ===');

// Create a complex AI workflow using the fluent builder pattern
const documentAnalysisWorkflow = flow<{ userDocument: string }>({
  debug: true, // Enable logging to see the flow execution
  autoParallel: true, // Enable automatic parallelization
})
  // Step 1: Summarize the document
  .node(
    'summarizer',
    'documentText:string "Raw document content" -> summaryText:string "Concise summary"'
  )

  // Step 2: Analyze sentiment of the summary
  .node(
    'sentimentAnalyzer',
    'contentText:string "Text to analyze" -> sentimentType:class "positive, negative, neutral" "Sentiment classification", confidenceScore:number "Confidence 0-1"'
  )

  // Step 3: Extract key topics
  .node(
    'topicExtractor',
    'sourceText:string "Source text" -> keyTopics:string[] "Important topics", topicCount:number "Number of topics found"'
  )

  // Execute the summarizer with the input document
  .execute('summarizer', (state) => ({
    documentText: state.userDocument || 'No document provided',
  }))

  // Execute sentiment analysis on the summary
  .execute('sentimentAnalyzer', (state) => ({
    contentText: state.summarizerResult?.summaryText || '',
  }))

  // Execute topic extraction on the original document
  .execute('topicExtractor', (state) => ({
    sourceText: state.userDocument || '',
  }))

  // Transform the final state to include all results
  .map((state) => ({
    analysisComplete: true,
    documentSummary: state.summarizerResult?.summaryText || '',
    documentSentiment:
      state.sentimentAnalyzerResult?.sentimentType || 'neutral',
    sentimentConfidence: state.sentimentAnalyzerResult?.confidenceScore || 0,
    extractedTopics: state.topicExtractorResult?.keyTopics || [],
    topicsFound: state.topicExtractorResult?.topicCount || 0,
    processingTimestamp: new Date().toISOString(),
  }));

console.log('Workflow created successfully!');
console.log('Workflow type:', typeof documentAnalysisWorkflow);
console.log(
  'Has forward method:',
  typeof documentAnalysisWorkflow.forward === 'function'
);

// Example of a simpler workflow for comparison
const _simpleWorkflow = flow<{ rawInput: string }>()
  .node('processor', 'userInput:string -> processedOutput:string')
  .execute('processor', (state) => ({ userInput: state.rawInput || 'default' }))
  .map((state) => ({
    finalOutput: state.processorResult?.processedOutput || 'no result',
  }));

console.log('\nSimple workflow also created successfully!');

// Example showing different node creation methods
const _advancedWorkflow = flow<{ inputDocument: string }>()
  // Basic string signature
  .node('textAnalyzer', 'documentText:string -> analysisResult:string')

  // Execute and transform
  .execute('textAnalyzer', (state) => ({
    documentText: state.inputDocument || 'sample text',
  }))

  .map((state) => ({
    finalAnalysis: state.textAnalyzerResult?.analysisResult || 'no analysis',
    processed: true,
  }));

console.log('Advanced workflow features demonstrated!');

// Demonstrate the builder pattern benefits
console.log('\n=== Builder Pattern Benefits ===');
console.log('✅ Method chaining for readable flow construction');
console.log('✅ Type-safe state evolution through each step');
console.log('✅ Fluent API similar to signature builder f()');
console.log('✅ Full TypeScript inference and validation');
console.log('✅ Automatic parallelization and optimization');

// Show how to extend workflows
const _extendedWorkflow = flow<{ sourceData: string }>()
  .node('step1', 'userInput:string -> intermediateResult:string')
  .execute('step1', (state) => ({ userInput: state.sourceData || 'test' }))

  // Can continue chaining
  .node('step2', 'processedData:string -> finalOutput:string')
  .execute('step2', (state) => ({
    processedData: state.step1Result?.intermediateResult || 'processed',
  }))

  // Apply final transformation
  .map((state) => ({
    workflowComplete: true,
    step1Output: state.step1Result?.intermediateResult,
    step2Output: state.step2Result?.finalOutput,
    totalSteps: 2,
  }));

console.log('\nMulti-step workflow construction completed!');
console.log('\n=== Fluent Flow API Demo Complete ===');
