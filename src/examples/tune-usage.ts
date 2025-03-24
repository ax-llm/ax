import fs from 'fs'

import {
  AxAI,
  AxAIOpenAIModel,
  AxBootstrapFewShot,
  AxChainOfThought,
  AxEvalUtil,
  AxHFDataLoader,
  type AxMetricFn,
  AxRAG,
} from '@ax-llm/ax'

const hf = new AxHFDataLoader({
  // cspell:disable-next-line
  dataset: 'yixuantt/MultiHopRAG',
  split: 'train',
  config: 'MultiHopRAG',
  options: { length: 5 },
})

await hf.loadData()

const examples = await hf.getRows<{ question: string; answer: string }>({
  count: 20,
  fields: ['query', 'answer'],
  renameMap: { query: 'question', answer: 'answer' },
})

const fetchFromVectorDB = async (query: string) => {
  const cot = new AxChainOfThought<{ query: string }, { answer: string }>(
    'query -> answer:string "answer to the query"'
  )
  const { answer } = await cot.forward(ai, { query })
  return answer
}

// Setup the program to tune
const program = new AxRAG(fetchFromVectorDB, { maxHops: 1 })

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4O, maxTokens: 3000 },
})
ai.setOptions({ debug: true })

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  ai,
  program,
  examples,
})

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return AxEvalUtil.emScore(
    prediction.answer as string,
    example.answer as string
  )
}

// Run the optimizer
const result = await optimize.compile(metricFn)

// save the resulting demonstrations to use later
const values = JSON.stringify(result, null, 2)
await fs.promises.writeFile('./qna-tune-demos.json', values)

console.log('> done. test with qna-use-tuned.ts')
