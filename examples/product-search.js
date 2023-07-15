import {
  AnthropicDefaultOptions,
  SPrompt,
  TogetherChatModel,
  TogetherDefaultOptions,
  TogetherLanguageModel,
} from '@dosco/llm-client';
import { Anthropic, Together, Cohere, OpenAI } from '@dosco/llm-client';

import chalk from 'chalk';

const InitAI = () => {
  if (process.env.COHERE_APIKEY) {
    return new Cohere(process.env.COHERE_APIKEY);
  } else if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.TOGETHER_APIKEY) {
    return new Together(process.env.TOGETHER_APIKEY);
  } else if (process.env.ANTHROPIC_APIKEY) {
    return new Anthropic(process.env.ANTHROPIC_APIKEY);
  }
  throw new Error('No LLM API key found');
};

const ai = InitAI();

const productDB = [
  { name: 'Macbook Pro', description: 'M2, 32GB', in_stock: 4321 },
  { name: 'Macbook Pro', description: 'M2, 96GB', in_stock: 2 },
  { name: 'iPad M1', description: 'M1, 8GB', in_stock: 0 },
];

const inventorySearch = ({ name, count }) => {
  return JSON.stringify(
    productDB.filter((v) => name.includes(v.name) && v.in_stock >= count)
  );
};

// List of functions available to the AI
const functions = [
  {
    name: 'inventorySearch',
    description: 'Used to search up a products inventory by its name',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'name of the product',
        },
        count: {
          type: 'number',
          description: 'number of products to search for',
        },
      },
      required: ['name', 'count'],
    },
    func: inventorySearch,
  },
];

const customerQuery = `Do you guys have 5 Macbook Pro's M2 with 96GB RAM and 3 iPads in stock?`;

const responseSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          units: { type: 'number' },
          desc: { type: 'string' },
        },
      },
    },
  },
};

const prompt = new SPrompt(responseSchema, functions);
prompt.setDebug(true);

const res = await prompt.generate(ai, customerQuery);
console.log(chalk.green('Result:\n', JSON.stringify(res.value(), null, 2)));
console.log(chalk.green('Tokens Used:\n', JSON.stringify(res.usage, null, 2)));
