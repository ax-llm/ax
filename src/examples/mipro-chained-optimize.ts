import fs from 'fs/promises'

import {
  ax,
  AxAI,
  AxAIOpenAIModel,
  type AxMetricFn,
  AxMiPRO,
  f,
} from '@ax-llm/ax'
import { AxDefaultCostTracker } from '@ax-llm/ax/dsp/optimizer.js'

// First generator: Summarize text
export const summarizerGen = ax`
  text:${f.string('Long text to summarize')} -> 
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
    text: 'The quarterly earnings report shows strong revenue growth of 15% year-over-year, driven primarily by increased customer acquisition in the enterprise segment. However, operating costs have risen by 12% due to expanded marketing spend and new office leases. The company remains optimistic about future growth prospects despite some market headwinds.',
    summary:
      'Company achieved 15% revenue growth but operating costs increased 12%. Strong enterprise customer growth offset by higher marketing and office expenses.',
  },
  {
    text: 'Climate scientists have published new research indicating that ocean temperatures have risen faster than previously predicted. The study, based on 20 years of satellite data, suggests that marine ecosystems are under greater stress than earlier models indicated. This could accelerate ice sheet melting and affect global weather patterns more rapidly than anticipated.',
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
  originalText:${f.string('Original text that was summarized')} ->
  candidateSummary:${f.string('Summary to evaluate')} ->
  expectedSummary:${f.string('Expected/reference summary')} ->
  score:${f.number('Quality score from 0.0 to 1.0')},
  reasoning:${f.string('Brief explanation of the score')}
`

// Create a function that returns an LLM judge-based metric function
const createSummaryMetric = (judgeAI: Readonly<AxAI>): AxMetricFn => {
  return async ({ prediction, example }) => {
    const candidateSummary = prediction.summary as string
    const expectedSummary = example.summary as string
    const originalText = example.text as string

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
const costTracker = new AxDefaultCostTracker()

// Use cheaper model for optimization
const optimizationAI = new AxAI({
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

console.log('=== Cost-Controlled Chained Optimization Demo ===')

// Step 1: Optimize the summarizer with cost controls
console.log('1. Optimizing summarizer with cost controls...')

// Create the LLM judge-based metric function
const summaryMetric = createSummaryMetric(optimizationAI)

const summaryOptimizer = new AxMiPRO({
  studentAI: optimizationAI,
  examples: summaryExamples,
  costTracker,
  options: {
    numCandidates: 2, // Reduced from default 8
    numTrials: 3, // Reduced from default 10
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
for (const text of newTexts) {
  const result = await summarizerGen.forward(inferenceAI, { text }) // Use cheaper model
  const sentiment =
    text.includes('exceeded') || text.includes('positive')
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

// Step 3: Optimize sentiment analyzer with even stricter cost controls
console.log('\n3. Optimizing sentiment analyzer with strict cost controls...')

// Create a more restrictive cost tracker for the second optimization
const restrictiveCostTracker = new AxDefaultCostTracker({
  maxTokens: 30000, // Even lower budget for second optimization
})

const sentimentOptimizer = new AxMiPRO({
  studentAI: optimizationAI,
  examples: allSentimentExamples,
  costTracker: restrictiveCostTracker,
  options: {
    numCandidates: 2,
    numTrials: 2, // Further reduced
    verbose: true,
    earlyStoppingTrials: 1,
    minImprovementThreshold: 0.01, // Stop if improvement is minimal
  },
})

const optimizedSentiment = await sentimentOptimizer.compile(
  sentimentGen,
  sentimentMetric
)

// Step 4: Test the cost-optimized pipeline
console.log('\n4. Testing optimized pipeline with inference model...')
if (optimizedSentiment.demos) {
  sentimentGen.setDemos(optimizedSentiment.demos)
}

const testText =
  'The merger talks have stalled due to regulatory concerns, but both companies remain committed to finding a path forward. Industry analysts are cautiously optimistic about the potential benefits.'

// Run through the pipeline using cheaper inference model
const summary = await summarizerGen.forward(inferenceAI, { text: testText })
const sentiment = await sentimentGen.forward(inferenceAI, {
  summary: summary.summary,
})

console.log('\n📈 Pipeline Results:')
console.log('Original:', testText)
console.log('Summary:', summary.summary)
console.log(
  'Sentiment:',
  sentiment.sentiment,
  `(confidence: ${sentiment.confidence})`
)

// Save both optimizations
await fs.writeFile(
  'summary-demos.json',
  JSON.stringify(optimizedSummarizer.demos, null, 2)
)
await fs.writeFile(
  'sentiment-demos.json',
  JSON.stringify(optimizedSentiment.demos, null, 2)
)

console.log(
  '✅ Saved optimizations to summary-demos.json and sentiment-demos.json'
)
