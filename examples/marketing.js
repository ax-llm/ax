import {
  Cohere,
  OpenAI,
  OpenAICreativeOptions,
  MessagePrompt,
  MessageType,
} from '@dosco/llm-client';

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

const context = `
1. Under 160 characters
2. Prompts recipients to book an call
3. Employs emojis and friendly language
`;

const res = await prompt.generate(ai, context);
console.log(res.value());
