import { AxAI, AxAIGoogleGeminiModel, AxChainOfThought } from '@ax-llm/ax'

// setup the prompt program
const gen = new AxChainOfThought<{ startNumber: number }>(
  `startNumber:number -> next10Numbers:number[]`
)

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined
}, 'Numbers 5 is not allowed')

gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(2) : undefined
}, 'Numbers 2 is not allowed')

// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
// })

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
})
ai.setOptions({ debug: true })

// run the program with streaming enabled
const res = await gen.forward(ai, { startNumber: 1 })

console.log('>', res)
