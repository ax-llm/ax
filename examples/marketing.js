import {
  Cohere,
  OpenAI,
  OpenAICreativeOptions,
  GenerateText,
  MessagePrompt,
  MessageType,
} from '@dosco/minds';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY, OpenAICreativeOptions());

const product = {
  name: 'Acme Toilet Cleaning',
  description: '24/7 Commercial and residential restroom cleaning services',
};

const to = {
  name: 'Jerry Doe',
  title: 'Head of facilities and operations',
  company: 'Blue Yonder Inc.',
};

const prompt = new MessagePrompt({ type: MessageType.Text }, product, to);
const gen = new GenerateText(ai);

const context = `
1. Under 160 characters
2. Prompts recipients to book an call
3. Employs emojis and friendly language
`;

const res = await gen.generate(context, prompt);
console.log(res.value());
