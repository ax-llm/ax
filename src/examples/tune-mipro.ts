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
  return prediction.label === example.label ? 1.0 : 0.0
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
let sumOfScores = 0
for (const example of validationData) {
  const prediction = await optimizedProgram.forward(ai, example)
  // metricFn will now return a score (1.0 or 0.0)
  const score = metricFn({ prediction, example })
  sumOfScores += score
  console.log(`Input: "${example.productReview}"`)
  console.log(`Expected: ${example.label}, Predicted: ${prediction.label}`)
  // Determine correctness for logging based on a threshold if desired, or just log score
  console.log(
    `Result: ${score === 1.0 ? '✓ CORRECT' : '✗ INCORRECT'} (Score: ${score})\n`
  )
}

// Report final performance metrics
const finalAverageScore =
  validationData.length > 0 ? sumOfScores / validationData.length : 0
console.log(
  `Final Average Score: ${finalAverageScore.toFixed(4)} (${sumOfScores}/${validationData.length})`
)
console.log(
  '> Done. Optimized program config saved to mipro-power-demo-config.json'
)

// --- Loading and Using Optimized Program Configuration ---
console.log('\n--- Loading and Using Optimized Program Configuration ---')

try {
  const loadedProgramConfigText = fs.readFileSync(
    './mipro-power-demo-config.json',
    'utf8'
  )
  const loadedConfig = JSON.parse(loadedProgramConfigText)
  console.log(
    'Successfully loaded configuration from mipro-power-demo-config.json'
  )
  // console.log('Keys in loadedConfig:', Object.keys(loadedConfig))
  // console.log('Loaded config demos:', loadedConfig.demos)
  // console.log('Loaded config signature:', loadedConfig.signature)

  // Instantiate a new program with the same signature
  const newProgram = new AxChainOfThought<
    { productReview: string },
    { label: string }
  >(`productReview -> label:string "positive" or "negative"`)
  console.log('New program instance created.')

  // Apply demos from loaded config
  if (loadedConfig.demos && Array.isArray(loadedConfig.demos)) {
    newProgram.setDemos(loadedConfig.demos)
    console.log(
      `Loaded ${loadedConfig.demos.length} demo sets into new program.`
    )
  } else {
    console.log(
      'No demos found or demos in unexpected format in loaded config.'
    )
  }

  // Apply instruction from loaded config
  // AxChainOfThought's main instruction is part of its signature, set at construction.
  // MiPRO's optimized instruction is what we'd want to apply.
  // If `setInstruction` on the original program (during optimization) modified
  // `this.signature.instruction`, it would be in `loadedConfig.signature.instruction`.
  if (loadedConfig.signature && loadedConfig.signature.instruction) {
    // This would typically require reconstructing the signature string if it's complex,
    // or having a dedicated method to set just the instruction part of a signature.
    // For AxChainOfThought, the instruction is the first part of the signature string.
    // If the *entire signature string* was changed and saved, that's different.
    // The `setInstruction` method in `AxProgramWithSignature` sets `this.signature.instruction`.
    // Let's assume the `loadedConfig.signature.instruction` is the relevant one.
    newProgram.setInstruction(loadedConfig.signature.instruction)
    console.log(
      'Loaded instruction from `loadedConfig.signature.instruction` into new program.'
    )
  } else if (typeof loadedConfig.instruction === 'string') {
    // Fallback if instruction is directly on the config object
    newProgram.setInstruction(loadedConfig.instruction)
    console.log(
      'Loaded instruction from `loadedConfig.instruction` into new program.'
    )
  } else {
    console.log(
      'No specific optimized instruction found in loaded config to apply directly via setInstruction, or format not recognized.'
    )
  }

  // Test the new program with loaded configuration
  console.log('\nTesting new program with loaded configuration:')
  const testExamples = validationData.slice(0, 2) // Test with first two validation examples

  for (const testExample of testExamples) {
    if (testExample) {
      const prediction = await newProgram.forward(ai, testExample)
      console.log(`\nInput: "${testExample.productReview}"`)
      console.log(
        `Expected: ${testExample.label}, Predicted: ${prediction.label}`
      )
      // You can use metricFn here too if you want to score it
      const score = metricFn({ prediction, example: testExample })
      console.log(
        `Result: ${score === 1.0 ? '✓ CORRECT' : '✗ INCORRECT'} (Score: ${score})`
      )
    }
  }
} catch (error) {
  console.error(
    'Error loading or using the optimized program configuration:',
    error
  )
}
