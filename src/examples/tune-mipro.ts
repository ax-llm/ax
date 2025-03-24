import fs from 'node:fs'

import {
  AxAI,
  AxAIGoogleGeminiModel,
  AxChainOfThought,
  type AxMetricFn,
  AxMiPRO,
} from '@ax-llm/ax'

// A small sentiment analysis dataset for text classification
// Each item is { productReview: string, label: "positive" | "negative" }
const trainingData = [
  { productReview: 'This product is amazing!', label: 'positive' },
  {
    productReview: 'Completely disappointed by the quality.',
    label: 'negative',
  },
  { productReview: 'Best purchase ever.', label: 'positive' },
  { productReview: 'I really hate how this turned out.', label: 'negative' },
  { productReview: 'The customer service was outstanding.', label: 'positive' },
  { productReview: 'They never responded to my emails.', label: 'negative' },
  { productReview: 'I would recommend this to everyone.', label: 'positive' },
  { productReview: 'This was a waste of money.', label: 'negative' },
  { productReview: 'Exactly what I was looking for!', label: 'positive' },
  {
    productReview: 'Very disappointed with the functionality.',
    label: 'negative',
  },
]

const validationData = [
  { productReview: 'Very happy with the results.', label: 'positive' },
  { productReview: 'Terrible experience, not recommended.', label: 'negative' },
  { productReview: 'Love how intuitive this product is!', label: 'positive' },
  { productReview: "Doesn't work as advertised at all.", label: 'negative' },
]

// Create AI service with appropriate model
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite, maxTokens: 1000 },
})

// A simple chain of thought program for classification
const classifyProgram = new AxChainOfThought<
  { productReview: string },
  { label: string }
>(`productReview -> label:string "positive" or "negative"`)

// Setup MiPRO optimizer with enhanced configuration
const optimizer = new AxMiPRO<{ productReview: string }, { label: string }>({
  ai,
  program: classifyProgram,
  examples: trainingData,
  options: {
    // Core MiPRO settings - tune these numbers based on your dataset
    numCandidates: 3, // Number of candidate programs to generate per trial
    numTrials: 10, // Number of optimization trials
    maxBootstrappedDemos: 2, // Maximum bootstrapped demos to create
    maxLabeledDemos: 3, // Maximum labeled demos to include

    // Advanced optimization improvements
    earlyStoppingTrials: 3, // Stop if no improvement after N trials
    minImprovementThreshold: 0.01, // Minimum score improvement to continue

    // Smarter program optimization
    programAwareProposer: true, // Use program structure for better optimization
    dataAwareProposer: true, // Consider dataset characteristics

    // Logging for transparency
    verbose: true,
  },
})

// Define a simple accuracy metric for sentiment classification
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return prediction.label === example.label
}

// Run the MiPRO optimization process
console.log('Starting MiPRO optimization for sentiment classification...')
console.log(
  'This process systematically searches for optimal prompt configurations.'
)

const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData,
  auto: 'medium', // Use medium optimization level (balances speed/quality)
})

// Save resulting configuration for future use
const programConfig = JSON.stringify(optimizedProgram, null, 2)
await fs.promises.writeFile('./mipro-power-demo-config.json', programConfig)

// Evaluate the optimized program on validation set
console.log('\nEvaluating optimized program on validation set:')
let correctCount = 0
for (const example of validationData) {
  const prediction = await optimizedProgram.forward(ai, example)
  const correct = metricFn({ prediction, example })
  if (correct) correctCount++
  console.log(`Input: "${example.productReview}"`)
  console.log(`Expected: ${example.label}, Predicted: ${prediction.label}`)
  console.log(`Result: ${correct ? '✓ CORRECT' : '✗ INCORRECT'}\n`)
}

// Report final performance metrics
const finalScore = correctCount / validationData.length
console.log(
  `Final accuracy: ${finalScore.toFixed(4)} (${correctCount}/${validationData.length})`
)
console.log(
  '> Done. Optimized program config saved to mipro-power-demo-config.json'
)
