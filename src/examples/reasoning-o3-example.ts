#!/usr/bin/env node

import { AxAI, AxAIOpenAIResponsesModel, AxGen, AxSignature } from '@ax-llm/ax'

// Mathematical reasoning example with o3
async function runMathExample() {
  console.log('📝 Example 1: Mathematical reasoning with o3')
  console.log('----------------------------------------')

  try {
    const ai = new AxAI({
      name: 'openai-responses',
      apiKey: process.env.OPENAI_APIKEY || '',
      config: {
        model: AxAIOpenAIResponsesModel.O3,
        reasoningEffort: 'medium',
        temperature: 0.7,
        stream: false,
      },
    })

    console.log(`🤖 Using model: ${AxAIOpenAIResponsesModel.O3}`)
    console.log('🔧 Reasoning effort: medium')

    const signature = new AxSignature(
      `question:string -> answer:string "step-by-step solution", thought:string "reasoning process", usage:string "model usage stats"`
    )

    const gen = new AxGen<
      { question: string },
      { answer: string; thought?: string; usage?: string }
    >(signature)

    const result = await gen.forward(ai, {
      question:
        'Solve this step by step: If a train travels 120 km in 1.5 hours, and then increases its speed by 20 km/h for the next 2 hours, what is the total distance traveled?',
    })

    console.log('✅ Response:')
    console.log(result.answer)

    if (result.thought) {
      console.log('\n🧠 Reasoning process:')
      console.log(result.thought)
    }

    console.log('\n📊 Usage:')
    if (result.usage) {
      console.log(result.usage)
    } else {
      console.log('  Usage stats not available')
    }
  } catch (error: Error | unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
      console.log('⚠️  o3 model not yet available on this API key')
      console.log('   This is expected - o3 is in limited preview')
    } else {
      console.error('❌ Error:', errorMessage)
    }
  }
}

// Code generation example with o4-mini
async function runCodeExample() {
  console.log('\n📝 Example 2: Code generation with o4-mini')
  console.log('-------------------------------------------')

  try {
    const ai = new AxAI({
      name: 'openai-responses',
      apiKey: process.env.OPENAI_APIKEY || '',
      config: {
        model: AxAIOpenAIResponsesModel.O4Mini,
        reasoningEffort: 'low',
        temperature: 0.3,
        stream: false,
      },
    })

    console.log(`🤖 Using model: ${AxAIOpenAIResponsesModel.O4Mini}`)
    console.log('🔧 Reasoning effort: low')

    const signature = new AxSignature(
      `task:string -> code:string "typescript function", explanation:string "how it works", thought:string "reasoning process"`
    )

    const gen = new AxGen<
      { task: string },
      { code: string; explanation: string; thought?: string }
    >(signature)

    const result = await gen.forward(ai, {
      task: 'Create a TypeScript function that calculates the factorial of a number using recursion',
    })

    console.log('✅ Code generated:')
    console.log(result.code)
    console.log('\n📖 Explanation:')
    console.log(result.explanation)

    if (result.thought) {
      console.log('\n🧠 Reasoning process:')
      console.log(result.thought)
    }
  } catch (error: Error | unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
      console.log('⚠️  o4-mini model not yet available on this API key')
      console.log('   This is expected - o4 models are in limited preview')
    } else {
      console.error('❌ Error:', errorMessage)
    }
  }
}

// Logic reasoning example with o3-mini
async function runLogicExample() {
  console.log('\n📝 Example 3: Logic reasoning with o3-mini')
  console.log('------------------------------------------')

  try {
    const ai = new AxAI({
      name: 'openai-responses',
      apiKey: process.env.OPENAI_APIKEY || '',
      config: {
        model: AxAIOpenAIResponsesModel.O3Mini,
        reasoningEffort: 'high',
        temperature: 0.1,
        stream: false,
      },
    })

    console.log(`🤖 Using model: ${AxAIOpenAIResponsesModel.O3Mini}`)
    console.log('🔧 Reasoning effort: high')

    const signature = new AxSignature(
      `premise:string -> conclusion:string "logical deduction", confidence:string "high, medium, low", thought:string "reasoning process"`
    )

    const gen = new AxGen<
      { premise: string },
      { conclusion: string; confidence: string; thought?: string }
    >(signature)

    const result = await gen.forward(ai, {
      premise:
        'All birds can fly. Penguins are birds. However, penguins cannot fly. What logical conclusion can we draw?',
    })

    console.log('✅ Logical conclusion:')
    console.log(result.conclusion)
    console.log('\n🎯 Confidence:', result.confidence)

    if (result.thought) {
      console.log('\n🧠 Reasoning process:')
      console.log(result.thought)
    }
  } catch (error: Error | unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
      console.log('⚠️  o3-mini model not yet available on this API key')
      console.log('   This is expected - o3 models are in limited preview')
    } else {
      console.error('❌ Error:', errorMessage)
    }
  }
}

async function main() {
  console.log('🧠 OpenAI Responses API with o3/o4 Models Example')
  console.log('==================================================')

  if (!process.env.OPENAI_APIKEY) {
    console.error('❌ Please set OPENAI_APIKEY environment variable')
    process.exit(1)
  }

  // Run all examples
  await runMathExample()
  await runCodeExample()
  await runLogicExample()

  console.log('\n🎉 Examples complete!')
  console.log('\nℹ️  Available reasoning models:')
  console.log(`  • ${AxAIOpenAIResponsesModel.O3} - Advanced reasoning model`)
  console.log(
    `  • ${AxAIOpenAIResponsesModel.O3Mini} - Efficient reasoning model`
  )
  console.log(
    `  • ${AxAIOpenAIResponsesModel.O4Mini} - Latest mini reasoning model`
  )
  console.log('\n📚 These models are currently in limited preview.')
  console.log('   Contact OpenAI for access to o3/o4 models.')
}

main().catch(console.error)
