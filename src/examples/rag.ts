import { AxAI, AxChainOfThought, AxRAG } from '@ax-llm/ax'

// simulated vector db call using an llm
const fetchFromVectorDB = async (query: string) => {
  const cot = new AxChainOfThought<{ query: string }, { answer: string }>(
    'query -> answer'
  )
  const { answer } = await cot.forward(ai, { query })
  return answer
}

const rag = new AxRAG(fetchFromVectorDB, { maxHops: 3 })

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

const res = await rag.forward(ai, {
  question:
    'List 3 of the top most important work done by Michael Stonebraker?',
})

console.log(res)
