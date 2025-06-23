import fs from 'fs/promises'

import {
  ax,
  AxAI,
  AxAIOpenAIModel,
  type AxCheckpointLoadFn,
  type AxCheckpointSaveFn,
  type AxMetricFn,
  AxMiPRO,
  f,
} from '@ax-llm/ax'
import { AxDefaultCostTracker } from '@ax-llm/ax/dsp/optimizer.js'

// First generator: Summarize text
export const summarizerGen = ax`
  documentText:${f.string('Long text to summarize')} -> 
  summary:${f.string('Concise summary of key points')}
`

// Second generator: Analyze sentiment of summaries
export const sentimentGen = ax`
  summary:${f.string('Text summary to analyze')} -> 
  sentiment:${f.class(['positive', 'negative', 'neutral'], 'Overall sentiment')},
  confidence:${f.number('Confidence score 0-1')}
`

// Examples for summarization
const summaryExamples = [
  {
    documentText:
      'The quarterly earnings report shows strong revenue growth of 15% year-over-year, driven primarily by increased customer acquisition in the enterprise segment. However, operating costs have risen by 12% due to expanded marketing spend and new office leases. The company remains optimistic about future growth prospects despite some market headwinds.',
    summary:
      'Company achieved 15% revenue growth but operating costs increased 12%. Strong enterprise customer growth offset by higher marketing and office expenses.',
  },
  {
    documentText:
      'Climate scientists have published new research indicating that ocean temperatures have risen faster than previously predicted. The study, based on 20 years of satellite data, suggests that marine ecosystems are under greater stress than earlier models indicated. This could accelerate ice sheet melting and affect global weather patterns more rapidly than anticipated.',
    summary:
      'New study shows ocean temperatures rising faster than predicted, threatening marine ecosystems and potentially accelerating climate change effects.',
  },
]

// Examples for sentiment analysis
const sentimentExamples = [
  {
    summary:
      'Company achieved 15% revenue growth but operating costs increased 12%. Strong enterprise customer growth offset by higher marketing expenses.',
    sentiment: 'neutral',
    confidence: 0.7,
  },
  {
    summary:
      'New study shows ocean temperatures rising faster than predicted, threatening marine ecosystems and accelerating climate change.',
    sentiment: 'negative',
    confidence: 0.9,
  },
]

// LLM Judge for summary evaluation
const summaryJudgeGen = ax`
  originalText:${f.string('Original text that was summarized')},
  candidateSummary:${f.string('Summary to evaluate')},
  expectedSummary:${f.string('Expected/reference summary')} ->
  score:${f.number('Quality score from 0.0 to 1.0')},
  reasoning:${f.string('Brief explanation of the score')}
`

// Create a function that returns an LLM judge-based metric function
const createSummaryMetric = (judgeAI: Readonly<AxAI>): AxMetricFn => {
  return async ({ prediction, example }) => {
    const candidateSummary = prediction.summary as string
    const expectedSummary = example.summary as string
    const originalText = example.documentText as string

    if (!candidateSummary || !expectedSummary || !originalText) return 0

    const judgeResult = await summaryJudgeGen.forward(judgeAI, {
      originalText,
      candidateSummary,
      expectedSummary,
    })

    return judgeResult.score as number
  }
}

const sentimentMetric: AxMetricFn = ({ prediction, example }) => {
  const predSentiment = prediction.sentiment as string
  const expectedSentiment = example.sentiment as string
  const predConfidence = prediction.confidence as number

  // Exact match for sentiment + confidence bonus
  const sentimentMatch = predSentiment === expectedSentiment ? 0.8 : 0
  const confidenceBonus = predConfidence > 0.5 ? 0.2 : 0

  return sentimentMatch + confidenceBonus
}

// Cost-optimized AI instances
const costTracker = new AxDefaultCostTracker({
  maxTokens: 100000,
})

// Teacher AI: Use more capable model for generating high-quality instructions
const teacherAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4O, // More capable model for instruction generation
    maxTokens: 500,
    temperature: 0.3, // Some creativity for diverse instructions
  },
})

// Student AI: Use cheaper model for optimization and inference
const studentAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini, // Much cheaper than GPT-4
    maxTokens: 300, // Limit output tokens
    temperature: 0.1, // More consistent, less creative (cheaper)
  },
})

// Even cheaper model for production inference
const inferenceAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT35Turbo, // Cheapest option
    maxTokens: 200,
    temperature: 0,
  },
})

console.log(
  '=== Teacher-Student Model Optimization with Checkpointing Demo ==='
)

// Set up simple checkpoint functions
const checkpoints = new Map()

const checkpointSave: AxCheckpointSaveFn = async (checkpoint) => {
  const id = `checkpoint_${checkpoint.timestamp}_${checkpoint.optimizerType}`
  checkpoints.set(id, checkpoint)
  console.log(`💾 Saved checkpoint: ${id}`)
  return id
}

const checkpointLoad: AxCheckpointLoadFn = async (id) => {
  return checkpoints.get(id) || null
}

// Step 1: Optimize the summarizer with teacher-student setup and checkpointing
console.log(
  '1. Optimizing summarizer with teacher-student AI setup and checkpointing...'
)


// Create the LLM judge-based metric function
const summaryMetric = createSummaryMetric(studentAI)

const summaryOptimizer = new AxMiPRO({
  studentAI, // Cheaper model for optimization
  teacherAI, // More capable model for instruction generation
  examples: summaryExamples,
  costTracker,
  checkpointSave, // Enable checkpointing
  checkpointLoad, // Enable checkpoint loading
  checkpointInterval: 5, // Save checkpoint every 5 rounds
  options: {
    numCandidates: 3, // Teacher will generate diverse instructions
    numTrials: 5,
    verbose: true, // Show progress
    earlyStoppingTrials: 2, // Stop early if no improvement
  },
})

const optimizedSummarizer = await summaryOptimizer.compile(
  summarizerGen,
  summaryMetric
)

// Step 2: Use optimized summarizer to generate examples (with cost control)
console.log('\n2. Generating examples with optimized summarizer...')
if (optimizedSummarizer.demos) {
  summarizerGen.setDemos(optimizedSummarizer.demos)
}

// Use fewer new texts to control costs
const newTexts = [
  'The product launch exceeded all expectations with pre-orders surpassing targets by 300%. Customer feedback has been overwhelmingly positive, praising the innovative design and competitive pricing.',
]

const generatedExamples = []
for (const documentText of newTexts) {
  const result = await summarizerGen.forward(inferenceAI, { documentText }) // Use cheaper model
  const sentiment =
    documentText.includes('exceeded') || documentText.includes('positive')
      ? 'positive'
      : 'negative'
  const confidence = 0.8

  generatedExamples.push({
    summary: result.summary,
    sentiment,
    confidence,
  })
}

// Combine with original examples
const allSentimentExamples = [...sentimentExamples, ...generatedExamples]

// Step 3: Optimize sentiment analyzer with teacher-student setup
console.log('\n3. Optimizing sentiment analyzer with teacher-student setup...')

// Create a more restrictive cost tracker for the second optimization
const restrictiveCostTracker = new AxDefaultCostTracker({
  maxTokens: 50000, // Lower budget for second optimization
})

const sentimentOptimizer = new AxMiPRO({
  studentAI, // Same cheaper model for optimization
  teacherAI, // Same capable model for instruction generation
  examples: allSentimentExamples,
  costTracker: restrictiveCostTracker,
  checkpointSave, // Enable checkpointing for second optimization too
  checkpointLoad, // Enable checkpoint loading
  checkpointInterval: 3, // More frequent checkpoints for shorter run
  options: {
    numCandidates: 3,
    numTrials: 4,
    verbose: true,
    earlyStoppingTrials: 2,
    minImprovementThreshold: 0.01, // Stop if improvement is minimal
  },
})

const optimizedSentiment = await sentimentOptimizer.compile(
  sentimentGen,
  sentimentMetric
)

// Step 4: Demonstrate runtime teacher override
console.log('\n4. Testing with runtime teacher AI override...')

// Create an even more capable teacher for final optimization
const premiumTeacherAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4O, // Premium model
    maxTokens: 800,
    temperature: 0.2,
  },
})

// Re-optimize with premium teacher override
console.log(
  '   Using premium teacher AI override for enhanced instruction generation...'
)
const enhancedOptimizer = new AxMiPRO({
  studentAI,
  teacherAI, // Original teacher
  examples: summaryExamples.slice(0, 1), // Use fewer examples for demo
  options: {
    numCandidates: 2,
    numTrials: 2,
    verbose: true,
  },
})

const enhancedResult = await enhancedOptimizer.compile(
  summarizerGen,
  summaryMetric,
  {
    overrideTeacherAI: premiumTeacherAI, // Override with premium teacher
    verbose: true,
  }
)

// Step 5: Test the optimized pipeline
console.log('\n5. Testing optimized pipeline with inference model...')
if (optimizedSentiment.demos) {
  sentimentGen.setDemos(optimizedSentiment.demos)
}

const testDocumentText =
  'The merger talks have stalled due to regulatory concerns, but both companies remain committed to finding a path forward. Industry analysts are cautiously optimistic about the potential benefits.'

// Run through the pipeline using cheaper inference model
const summary = await summarizerGen.forward(inferenceAI, {
  documentText: testDocumentText,
})
const sentiment = await sentimentGen.forward(inferenceAI, {
  summary: summary.summary,
})

console.log('\n📈 Pipeline Results:')
console.log('Original:', testDocumentText)
console.log('Summary:', summary.summary)
console.log(
  'Sentiment:',
  sentiment.sentiment,
  `(confidence: ${sentiment.confidence})`
)

// Save all optimizations
await fs.writeFile(
  'summary-demos.json',
  JSON.stringify(optimizedSummarizer.demos, null, 2)
)
await fs.writeFile(
  'sentiment-demos.json',
  JSON.stringify(optimizedSentiment.demos, null, 2)
)
await fs.writeFile(
  'enhanced-demos.json',
  JSON.stringify(enhancedResult.demos, null, 2)
)

// List available checkpoints
const checkpointList = Array.from(checkpoints.keys())
console.log('\n📁 Available Checkpoints:')
if (checkpointList.length > 0) {
  checkpointList.forEach((checkpoint) => {
    console.log(`   - ${checkpoint}`)
  })
} else {
  console.log('   No checkpoints found')
}

console.log(
  '✅ Saved optimizations to summary-demos.json, sentiment-demos.json, and enhanced-demos.json'
)
console.log(`✅ Checkpoints saved in memory (${checkpointList.length} total)`)
