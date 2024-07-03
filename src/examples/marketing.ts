import { AxAI, AxGenerate } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const product = {
  name: 'Acme Toilet Cleaning',
  description: '24/7 Commercial and residential restroom cleaning services'
};

const to = {
  name: 'Jerry Doe',
  title: 'Head of facilities and operations',
  company: 'Blue Yonder Inc.'
};

const messageGuidelines = [
  'Under 160 characters',
  'Prompts recipients to book an call',
  'Employs emojis and friendly language'
];

const gen = new AxGenerate(
  ai,
  `productName, productDescription, toName, toDescription, messageGuidelines -> message`
);

const res = await gen.forward({
  productName: product.name,
  productDescription: product.description,
  toName: to.name,
  toDescription: to.title,
  messageGuidelines: messageGuidelines.join(', ')
});

console.log('>', res);
