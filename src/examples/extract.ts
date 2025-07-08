import { AxAI, AxAIGoogleGeminiModel, AxGen } from '@ax-llm/ax';

const chatMessage =
  'Hello Mike, How are you set for a call tomorrow or Friday? I have a few things to discuss with you. Also the ticket number is 300. Let me know what time works best for you. Thanks!';

const currentDate = new Date();

// Example with OpenAI using custom labels in place of model names
// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { model: 'model-a' },
//   models: [
//     {
//       key: 'model-a',
//       model: AxAIOpenAIModel.GPT4OMini,
//       description: 'A model that is good for general purpose',
//     },
//   ],
// })

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini25FlashLite },
  options: { timeout: 5000 },
  models: [
    {
      key: 'model-a',
      model: AxAIGoogleGeminiModel.Gemini25FlashLite,
      description: 'A model that is good for general purpose',
    },
  ],
});
// ai.setOptions({ debug: true })

const gen = new AxGen<{ chatMessage: string; currentDate: Date }>(
  `chatMessage, currentDate:datetime -> subject, thinking, reasoning, foundMeeting:boolean, ticketNumber?:number, customerNumber?:number, datesMentioned:datetime[], shortSummary, messageType:class "reminder, follow-up, meeting, other"`
);

const stream = await gen.streamingForward(ai, { chatMessage, currentDate });

console.log('# Streaming');

for await (const chunk of stream) {
  console.log('>', chunk);
}

// console.log('\n\n# Not Streaming')

// const res = await gen.forward(ai, { chatMessage, currentDate })
// console.log('>', res)
