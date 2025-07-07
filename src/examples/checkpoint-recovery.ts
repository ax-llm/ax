import {
  ax,
  AxAI,
  AxAIOpenAIModel,
  type AxCheckpointLoadFn,
  type AxCheckpointSaveFn,
  type AxMetricFn,
  AxMiPRO,
  type AxOptimizationCheckpoint,
  f,
} from '@ax-llm/ax'

// Example checkpoint functions for different storage systems
const createMemoryCheckpoint = () => {
  const storage = new Map<string, AxOptimizationCheckpoint>()

  const save: AxCheckpointSaveFn = async (checkpoint) => {
    const id = `checkpoint_${checkpoint.timestamp}_${checkpoint.optimizerType}`
    storage.set(id, checkpoint)
    console.log(`💾 Memory: Saved checkpoint ${id}`)
    return id
  }

  const load: AxCheckpointLoadFn = async (id) => {
    return storage.get(id) || null
  }

  const list = () => Array.from(storage.keys()).sort()
  const size = () => storage.size

  return { save, load, list, size }
}

// Example: localStorage checkpoint functions (for browsers)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createBrowserCheckpoint = () => {
  const storageKey = 'ax-checkpoints'

  const save: AxCheckpointSaveFn = async (checkpoint) => {
    const id = `checkpoint_${checkpoint.timestamp}_${checkpoint.optimizerType}`
    const storage = JSON.parse(localStorage.getItem(storageKey) || '{}')
    storage[id] = checkpoint
    localStorage.setItem(storageKey, JSON.stringify(storage))
    console.log(`💾 Browser: Saved checkpoint ${id}`)
    return id
  }

  const load: AxCheckpointLoadFn = async (id) => {
    const storage = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return storage[id] || null
  }

  return { save, load }
}

// Example: Mock database checkpoint functions
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createDatabaseCheckpoint = () => {
  // Mock database storage
  const mockDB = new Map<string, AxOptimizationCheckpoint>()

  const save: AxCheckpointSaveFn = async (checkpoint) => {
    const id = `checkpoint_${checkpoint.timestamp}_${checkpoint.optimizerType}`
    // In real implementation: await db.checkpoints.create({ id, data: checkpoint })
    mockDB.set(id, checkpoint)
    console.log(`💾 Database: Saved checkpoint ${id}`)
    return id
  }

  const load: AxCheckpointLoadFn = async (id) => {
    // In real implementation: const result = await db.checkpoints.findUnique({ where: { id } })
    return mockDB.get(id) || null
  }

  return { save, load }
}

// Simple sentiment analysis program
export const sentimentAnalyzer = ax`
  reviewText:${f.string('Customer review text')} -> 
  sentiment:${f.class(['positive', 'negative', 'neutral'], 'Overall sentiment')},
  confidence:${f.number('Confidence score 0-1')}
`

// Training examples
const examples = [
  {
    reviewText: 'I absolutely love this product!',
    sentiment: 'positive',
    confidence: 0.9,
  },
  {
    reviewText: 'This is terrible quality, waste of money',
    sentiment: 'negative',
    confidence: 0.8,
  },
  {
    reviewText: 'It works fine, nothing special',
    sentiment: 'neutral',
    confidence: 0.6,
  },
  {
    reviewText: 'Best purchase I ever made!',
    sentiment: 'positive',
    confidence: 0.95,
  },
  {
    reviewText: 'Completely useless, returned immediately',
    sentiment: 'negative',
    confidence: 0.9,
  },
  {
    reviewText: 'Average product, does what it says',
    sentiment: 'neutral',
    confidence: 0.7,
  },
  {
    reviewText: 'Exceeded my expectations, highly recommend!',
    sentiment: 'positive',
    confidence: 0.85,
  },
  {
    reviewText: 'Poor build quality, broke after one week',
    sentiment: 'negative',
    confidence: 0.8,
  },
]

// Metric function
const metric: AxMetricFn = ({ prediction, example }) => {
  let score = 0
  if (prediction.sentiment === example.sentiment) score += 0.7

  // Bonus for confidence alignment
  const predConfidence = prediction.confidence as number
  const expectedConfidence = example.confidence as number
  const confidenceDiff = Math.abs(predConfidence - expectedConfidence)
  if (confidenceDiff < 0.2) score += 0.3

  return score
}

// AI setup
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
    maxTokens: 200,
    temperature: 0.1,
  },
})

console.log('=== Simple Function-Based Checkpointing Demo ===')

// Demonstrate different checkpoint implementations
console.log('\n📦 Available checkpoint implementations:')
console.log('1. Memory storage (Map)')
console.log('2. Browser storage (localStorage)')
console.log('3. Database storage (mock)')

// Create checkpoint functions - choose your storage
const memoryCheckpoint = createMemoryCheckpoint()
// const browserCheckpoint = createBrowserCheckpoint()
// const databaseCheckpoint = createDatabaseCheckpoint()

// For this demo, we'll use memory storage
const {
  save: checkpointSave,
  load: checkpointLoad,
  list,
  size,
} = memoryCheckpoint

// Check for existing checkpoints
const existingCheckpoints = list()
console.log(`\nFound ${existingCheckpoints.length} existing checkpoints`)

let resumeFromCheckpoint: string | undefined

if (existingCheckpoints.length > 0) {
  // Find the most recent checkpoint
  const sortedCheckpoints = existingCheckpoints.sort().reverse()
  resumeFromCheckpoint = sortedCheckpoints[0]
  console.log(`Will resume from: ${resumeFromCheckpoint}`)

  // Load and display checkpoint info
  const checkpoint = await checkpointLoad(resumeFromCheckpoint!)
  if (checkpoint) {
    console.log(`Checkpoint details:`)
    console.log(
      `  - Round: ${checkpoint.currentRound}/${checkpoint.totalRounds}`
    )
    console.log(`  - Best Score: ${checkpoint.bestScore.toFixed(3)}`)
    console.log(
      `  - Timestamp: ${new Date(checkpoint.timestamp).toLocaleString()}`
    )
  }
} else {
  console.log('No existing checkpoints found, starting fresh optimization')
}

// Create optimizer with simple checkpoint functions
const optimizer = new AxMiPRO({
  studentAI: ai,
  examples,
  checkpointSave,
  checkpointLoad,
  checkpointInterval: 3, // Save every 3 rounds
  resumeFromCheckpoint, // Resume from checkpoint if available
  options: {
    numCandidates: 4,
    numTrials: 15, // Longer run to demonstrate checkpointing
    verbose: true,
    earlyStoppingTrials: 5,
  },
})

console.log('\nStarting optimization...')
console.log('💡 Tip: This shows how simple checkpoint functions can be!')

try {
  const result = await optimizer.compile(sentimentAnalyzer, metric, {
    verbose: true,
    saveCheckpointOnComplete: true, // Save final checkpoint
  })

  console.log(`\n✅ Optimization complete!`)
  console.log(`Final score: ${(result.bestScore * 100).toFixed(1)}%`)

  // Apply the optimized configuration
  if (result.demos) {
    sentimentAnalyzer.setDemos(result.demos)
  }

  // Test the optimized model
  console.log('\n🧪 Testing optimized model:')
  const testReviews = [
    'This product changed my life, absolutely incredible!',
    'Mediocre at best, nothing to write home about',
    'Worst purchase ever, complete garbage',
  ]

  for (const review of testReviews) {
    const analysis = await sentimentAnalyzer.forward(ai, { reviewText: review })
    console.log(`Review: "${review}"`)
    console.log(
      `Analysis: ${analysis.sentiment} (confidence: ${analysis.confidence})`
    )
    console.log('')
  }
} catch (error) {
  console.error('Optimization failed:', error)
  console.log("💡 Don't worry! Your progress has been saved in checkpoints.")
  console.log('You can restart this script to resume from the last checkpoint.')
}

// Show final stats
console.log(`\n📊 Final checkpoint stats:`)
console.log(`  - Total checkpoints: ${size()}`)
console.log(`  - Checkpoint IDs: ${list().join(', ')}`)

console.log('\n🎯 Key Takeaways:')
console.log('1. Just two simple functions: save and load')
console.log('2. Works with any storage: memory, localStorage, databases, cloud')
console.log('3. No complex interfaces or classes needed')
console.log('4. Easy to implement for your specific storage needs')
console.log('5. Checkpoints contain complete optimization state')

console.log('\n💡 Implementation Examples:')
console.log('- Memory: Map<string, checkpoint>')
console.log('- Browser: localStorage.setItem(id, JSON.stringify(checkpoint))')
console.log('- Database: await db.checkpoints.create({ id, data: checkpoint })')
console.log(
  '- Cloud: await s3.putObject({ Key: id, Body: JSON.stringify(checkpoint) })'
)
console.log(
  '- File: fs.writeFileSync(`${id}.json`, JSON.stringify(checkpoint))'
)
