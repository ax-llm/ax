import fs from 'fs/promises'

import { ax, AxAI, AxAIOpenAIModel, f } from '@ax-llm/ax'

import { reasoningGen } from './mipro-optimized-gen-demo.js'

/**
 * Demonstrates loading and using previously optimized demos
 * This shows how to use the teacher model's knowledge with a smaller, cheaper model
 */

console.log('=== Loading Optimized Complex Reasoning ===\n')

// Load the saved demos
const demosData = await fs.readFile('reasoning-demos.json', 'utf-8')
const demos = JSON.parse(demosData)

console.log('✅ Loaded optimization demos')
console.log('Demo groups:', demos.length)

// Set demos on the imported generator
reasoningGen.setDemos(demos)

console.log('\n=== Using Cheaper Model with Teacher Knowledge ===')

// Use a much cheaper model that benefits from the teacher's optimization
const cheapAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT35Turbo }, // Much cheaper than GPT-4
})

console.log('Inference model: GPT-3.5 Turbo (cheap & fast)')

// Test scenarios that require sophisticated reasoning
const testScenarios = [
  "A crypto influencer promotes a 'revolutionary' new coin while quietly selling their holdings.",
  'A fitness app claims 99% user satisfaction but has 90% uninstall rate within a week.',
  "A news article states 'studies show coffee causes cancer' but cites only one retracted paper.",
  'A politician promises to eliminate unemployment while also promising to reduce immigration.',
]

console.log('\n=== Analyzing Complex Scenarios ===')

for (let i = 0; i < testScenarios.length; i++) {
  const scenario = testScenarios[i]
  console.log(`\n${i + 1}. Scenario: ${scenario}`)

  const result = await reasoningGen.forward(cheapAI, { scenario })
  console.log(`   Analysis: ${result.analysis}`)
}

// Compare with non-optimized baseline
console.log('\n=== Baseline Comparison (No Optimization) ===')

const baselineGen = ax`
  scenario:${f.string('Business or logical scenario to analyze')} -> 
  analysis:${f.string('Critical analysis explaining what is wrong or misleading about the scenario')}
`

const testScenario = testScenarios[0]
console.log(`\nTesting: ${testScenario}`)

const baselineResult = await baselineGen.forward(cheapAI, {
  scenario: testScenario,
})
console.log(`Baseline (no demos): ${baselineResult.analysis}`)

const optimizedResult = await reasoningGen.forward(cheapAI, {
  scenario: testScenario,
})
console.log(`Optimized (with demos): ${optimizedResult.analysis}`)

console.log('\n📊 Notice how the optimized version likely provides:')
console.log('• More structured reasoning')
console.log('• Specific identification of logical flaws')
console.log('• Better use of reasoning vocabulary')
console.log('• More comprehensive analysis')

// Production example
console.log('\n' + '='.repeat(50))
console.log('=== Production Usage Pattern ===\n')

const demosData2 = await fs.readFile('reasoning-demos.json', 'utf-8')
const demos2 = JSON.parse(demosData2)

// Set demos on the reasoning generator
reasoningGen.setDemos(demos2)

// Production AI instance (cost-optimized)
const productionAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT35Turbo,
    maxTokens: 500, // Control costs
    temperature: 0.1, // More consistent outputs
  },
})

console.log('✅ Production setup:')
console.log('• Optimized with teacher model (GPT-4o-mini)')
console.log('• Running on cost-effective model (GPT-3.5)')
console.log('• Ready for high-volume usage')

// Simulate production usage
const businessScenarios = [
  'Our new marketing campaign has 10x higher CTR but 5x lower conversion rate.',
  "The startup claims 'profitable growth' but is burning $1M monthly with $100K revenue.",
  'Survey shows 95% customer satisfaction but customer retention is only 30%.',
]

console.log('\n=== Batch Processing Demo ===')

for (const scenario of businessScenarios) {
  const analysis = await reasoningGen.forward(productionAI, { scenario })
  console.log(`\n📊 ${scenario}`)
  console.log(`🔍 ${analysis.analysis}`)
}

console.log('\n' + '='.repeat(50))
console.log('=== Key Benefits Demonstrated ===')
console.log('• Teacher model knowledge preserved in demos')
console.log('• Cheap inference model performs better')
console.log('• Clean separation: optimize once, use anywhere')
console.log('• Ready for production deployment')
console.log('• Significant cost savings vs teacher model')
