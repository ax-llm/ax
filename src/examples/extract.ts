import { AxAI, AxAIOpenAIModel, AxGenerate } from '@ax-llm/ax';

const chatMessage = `Hello Mike, How are you set for a call tomorrow or Friday? I have a few things to discuss with you. Let me know what time works best for you. Thanks!`;

const currentDate = new Date().toUTCString();

// Example with OpenAI using custom labels in place of model names
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: 'model-a' },
  modelMap: {
    'model-a': AxAIOpenAIModel.GPT4OMini
  }
});

const gen = new AxGenerate(
  ai,
  `chatMessage, currentDate -> subject, foundMeeting:boolean, dateMentioned:datetime`
);

const res = await gen.forward(
  { chatMessage, currentDate },
  { modelConfig: { stream: true } }
);

console.log('>', res);
