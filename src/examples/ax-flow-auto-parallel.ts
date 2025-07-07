// AxFlow automatic parallelization example
import { AxAI, AxAIGoogleGeminiModel, AxFlow } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
})

async function runAutoParallelDemo() {
  console.log('=== AxFlow Automatic Parallelization Demo ===')

  // Create a flow with automatic parallelization enabled (default)
  const autoFlow = new AxFlow<
    { documentText: string },
    { finalAnalysis: string }
  >()
    .node('summarizer', 'documentText:string -> documentSummary:string')
    .node(
      'keywordExtractor',
      'documentText:string -> documentKeywords:string[]'
    )
    .node(
      'sentimentAnalyzer',
      'documentText:string -> documentSentiment:string'
    )
    .node(
      'combiner',
      'documentSummary:string, documentKeywords:string[], documentSentiment:string -> combinedAnalysis:string'
    )
    .execute('summarizer', (state) => ({ documentText: state.documentText }))
    .execute('keywordExtractor', (state) => ({
      documentText: state.documentText,
    }))
    .execute('sentimentAnalyzer', (state) => ({
      documentText: state.documentText,
    }))
    .execute('combiner', (state) => ({
      documentSummary: state.summarizerResult.documentSummary,
      documentKeywords: state.keywordExtractorResult.documentKeywords,
      documentSentiment: state.sentimentAnalyzerResult.documentSentiment,
    }))
    .map((state) => ({ finalAnalysis: state.combinerResult.combinedAnalysis }))

  // Show execution plan
  const plan = autoFlow.getExecutionPlan()
  console.log(`\n📊 Execution Plan:`)
  console.log(`   Total Steps: ${plan.totalSteps}`)
  console.log(`   Parallel Groups: ${plan.parallelGroups}`)
  console.log(`   Max Parallelism: ${plan.maxParallelism}`)
  console.log(
    `   Auto-Parallel: ${plan.autoParallelEnabled ? '✅ Enabled' : '❌ Disabled'}`
  )

  // Test document
  const testDoc = {
    documentText:
      'The new AI technology is revolutionary and will change everything. However, we must be careful about its implementation to ensure safety and ethical use. This breakthrough represents a significant advancement in machine learning capabilities.',
  }

  console.log('\n🚀 Running Auto-Parallel Execution...')
  const autoStart = Date.now()
  const autoResult = await autoFlow.forward(ai, testDoc)
  const autoTime = Date.now() - autoStart

  console.log('✅ Auto-parallel result:', autoResult)
  console.log(`⏱️  Auto-parallel time: ${autoTime}ms`)

  // Compare with sequential execution
  console.log('\n🐌 Running Sequential Execution (for comparison)...')
  const sequentialStart = Date.now()
  const sequentialResult = await autoFlow.forward(ai, testDoc, {
    autoParallel: false,
  })
  const sequentialTime = Date.now() - sequentialStart

  console.log('✅ Sequential result:', sequentialResult)
  console.log(`⏱️  Sequential time: ${sequentialTime}ms`)

  // Performance comparison
  const speedup = (sequentialTime / autoTime).toFixed(2)
  const speedupNum = parseFloat(speedup)
  console.log('\n📈 Performance Comparison:')
  console.log(`   Auto-parallel: ${autoTime}ms`)
  console.log(`   Sequential: ${sequentialTime}ms`)
  console.log(`   Speedup: ${speedup}x ${speedupNum > 1 ? '🚀' : ''}`)

  // Show how the parallelization works
  console.log('\n🔍 How Automatic Parallelization Works:')
  console.log(
    '   Level 0 (Parallel): summarizer, keywordExtractor, sentimentAnalyzer'
  )
  console.log('   Level 1 (Sequential): combiner (waits for Level 0)')
  console.log('   Level 2 (Sequential): map (waits for Level 1)')
  console.log('\n   The first three nodes can run in parallel because they all')
  console.log(
    '   depend only on the input "documentText". The combiner must wait'
  )
  console.log('   for all three to complete before it can run.')

  console.log('\n✨ Benefits of Automatic Parallelization:')
  console.log('   • No manual .parallel() calls needed')
  console.log('   • Automatic dependency analysis')
  console.log('   • Optimal execution planning')
  console.log('   • Transparent performance improvements')
  console.log('   • Can be disabled per-execution if needed')
}

// Run the demo
runAutoParallelDemo().catch(console.error)
