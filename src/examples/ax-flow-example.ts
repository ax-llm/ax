// Example: Multi-Model Flow with AxFlow
// This example demonstrates the AxFlow API for building complex, stateful AI programs
// with different AI models for different tasks.

import { AxAI, AxFlow, f } from '@ax-llm/ax'

// Simple mock for demonstration (you would use real AI providers)
const cheapAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY || 'demo-key',
})

const powerfulAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY || 'demo-key',
})

// Define the multi-model flow as specified in the requirements
const multiModelFlow = new AxFlow<
  { topic: string },
  { summary: string; analysis: string }
>()
  // 1. Define nodes with their input/output signatures
  .node('summarizer', {
    'documentText:string': { summary: f.string('Generated summary') },
  })
  .node('analyzer', {
    'inputText:string': { analysis: f.string('Detailed analysis') },
  })

  // 2. Define orchestration logic
  .map((input) => ({
    originalText: `Some long text about ${input.topic}. This is a comprehensive discussion covering various aspects and implications of the topic.`,
  }))

  // Use the cheap AI for a simple summarization task
  .execute(
    'summarizer',
    (state) => ({
      documentText: state.originalText,
    }),
    { ai: cheapAI }
  )

  // Use the powerful AI for a complex analysis task
  .execute(
    'analyzer',
    (state) => ({
      inputText: state.originalText,
    }),
    { ai: powerfulAI }
  )

  // 3. Transform final state to match the OUT generic type
  .map((state) => ({
    summary: state.summarizerResult.summary,
    analysis: state.analyzerResult.analysis,
  }))

// Example with loops - demonstrates iterative processing
const iterativeFlow = new AxFlow<
  { iterations: number; data: string },
  { results: string[]; finalCount: number }
>()
  .node('processor', {
    'inputData:string, iterationNumber:number': {
      processedResult: f.string('Processed result'),
    },
  })
  .map((input) => ({
    ...input,
    results: [] as string[],
    currentIteration: 0,
  }))
  .while((state) => state.currentIteration < state.iterations)
  .map((state) => ({
    ...state,
    currentIteration: state.currentIteration + 1,
  }))
  .execute('processor', (state) => ({
    inputData: state.data,
    iterationNumber: state.currentIteration,
  }))
  .map((state) => ({
    ...state,
    results: [...state.results, state.processorResult.processedResult],
  }))
  .endWhile()
  .map((state) => ({
    results: state.results,
    finalCount: state.currentIteration,
  }))

// Example usage
async function runExamples() {
  console.log('=== AxFlow Multi-Model Example ===')

  try {
    // Execute the multi-model flow
    const result = await multiModelFlow.forward(powerfulAI, {
      topic: 'the future of AI',
    })

    console.log('Multi-model flow result:')
    console.log('Summary:', result.summary)
    console.log('Analysis:', result.analysis)

    console.log('\n=== AxFlow Iterative Example ===')

    // Execute the iterative flow
    const iterativeResult = await iterativeFlow.forward(cheapAI, {
      iterations: 3,
      data: 'Sample data to process',
    })

    console.log('Iterative flow result:')
    console.log('Results:', iterativeResult.results)
    console.log('Final count:', iterativeResult.finalCount)
  } catch (error) {
    console.error('Error running AxFlow examples:', error)
  }
}

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples()
}

// Export for use in other examples
export { multiModelFlow, iterativeFlow }
