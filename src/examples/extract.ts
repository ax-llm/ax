import { AxAI, AxAIGoogleGeminiModel, AxAIOpenAIModel, AxGen } from '@ax-llm/ax'

const chatMessage = `Hello Mike, How are you set for a call tomorrow or Friday? I have a few things to discuss with you. Also the ticket number is 300. Let me know what time works best for you. Thanks!`

const currentDate = new Date()

// Example with OpenAI using custom labels in place of model names
// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { model: 'model-a' },
//   modelMap: {
//     'model-a': AxAIOpenAIModel.GPT4OMini,
//   },
// })

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini15Flash8B },
  modelMap: {
    'model-a': AxAIGoogleGeminiModel.Gemini15Flash8B,
  },
})
ai.setOptions({ debug: true })

const gen = new AxGen(
  `chatMessage, currentDate:datetime -> subject, foundMeeting:boolean, ticketNumber?:number, customerNumber?:number, datesMentioned:datetime[], messageType:class "reminder, follow-up, meeting, other"`
)

const res = await gen.forward(ai, { chatMessage, currentDate })

console.log('>', res)
