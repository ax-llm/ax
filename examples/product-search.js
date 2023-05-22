import { z } from 'zod';
import { Cohere, OpenAI, ZPrompt, QuestionAnswerPrompt } from '@dosco/minds';

import chalk from 'chalk';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY);

const productDB = [
  { name: 'Macbook Pro', description: 'M2, 32GB', in_stock: 4321 },
  { name: 'Macbook Pro', description: 'M2, 96GB', in_stock: 2 },
];

const productSearch = (text, embeddings) => {
  return JSON.stringify(productDB.filter((v) => text.includes(v.name)));
};

// List of actions available to the AI
const actions = [
  {
    name: 'Product Search',
    description: 'Used to search up a products information by its name',
    action: productSearch,
  },
];

// const context = 'This question related to customer support';

const customerQuery = `Do you guys have 5 Macbook Pro's M2 with 96GB RAM and 3 iPads in stock?`;

const CustomerResponse = z.object({
  data: z
    .array(
      z.object({
        name: z.string().describe('product name'),
        units: z.number().describe('units in stock'),
        desc: z.string().max(15).describe('product description'),
      })
    )
    .describe('inventory information'),
  response: z.string().max(50).describe('customer response'),
});

// const prompt = new QuestionAnswerPrompt(actions);
const prompt = new ZPrompt(CustomerResponse, actions);
prompt.setDebug(true);

const res = await prompt.generate(ai, customerQuery);
console.log(chalk.green('Result:\n', res.value()));
