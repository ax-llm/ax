import { MessageType } from '@dosco/llm-client';
import { InitAI } from './util';

const ai = InitAI();

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
