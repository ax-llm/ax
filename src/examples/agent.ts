import { AxAgent, AxAI, AxAIOpenAIModel } from '@ax-llm/ax'

const researcher = new AxAgent({
  name: 'Physics Researcher',
  description:
    'Researcher for physics questions can answer questions about advanced physics',
  signature: `question, physicsQuestion "physics questions" -> answer "reply in bullet points"`,
})

const summarizer = new AxAgent({
  name: 'Science Summarizer',
  description:
    'Summarizer can write short summaries of advanced science topics',
  definition:
    'You are a science summarizer. You can write short summaries of advanced science topics. Use numbered bullet points to summarize the answer in order of importance.',
  signature: `answer "bullet points to summarize" -> shortSummary "summarize in 10 to 20 words"`,
})

const agent = new AxAgent<{ question: string }>({
  name: 'Scientist',
  description: 'An agent that can answer advanced science questions',
  signature: `question -> answer`,
  agents: [researcher, summarizer],
})

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  models: [
    {
      key: 'dumb',
      model: AxAIOpenAIModel.GPT35Turbo,
      description: 'Use the dumb model for very simple questions',
    },
    {
      key: 'smart',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'Use the smart model for advanced questions',
    },
    {
      key: 'smartest',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Use the smartest model for the most advanced questions',
    },
  ],
})
ai.setOptions({ debug: true })

// const ai = new AxAI({
//   name: 'google-gemini',
//   apiKey: process.env.GOOGLE_APIKEY as string
// });

// const ai = new AxAI({
//   name: 'groq',
//   apiKey: process.env.GROQ_APIKEY as string
// });

// const question = `What is a cat?`
const question = `Why is gravity not a real force?`

const res = await agent.forward(ai, { question })
console.log('>', res)
