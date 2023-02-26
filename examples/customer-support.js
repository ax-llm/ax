import {
  Cohere,
  OpenAI,
  Memory,
  GenerateText,
  QuestionAnswerPrompt,
} from '@dosco/minds';

import chalk from 'chalk';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY);

// Fake search action to simulate a product database search
const productSearch = (_text) => {
  return `
  We only have the following products currently in stock:
  1. name: Macbook Pro M2, details: Ram 32GB, stock_count: 4341
  2. name: Macbook Pro M2, details: Ram 96GB, stock_count: 2`;
};

const calculator = (text) => {
  return parser.evaluate(text);
};

// List of actions available to the AI
const actions = [
  {
    name: 'Product Search',
    description: 'Used to search up a products information by its name',
    action: productSearch,
  },
];

const context = 'This question related to customer support';

const mem = new Memory();
const prompt = new QuestionAnswerPrompt(actions, context);
const gen = new GenerateText(ai, mem);
gen.setDebug(true);

const customerQuery = `Do you guys have 5 Macbook Pro's M2 with 96GB RAM and 3 iPads in stock?`;

const res = await gen.generate(customerQuery, prompt);
console.log(chalk.green('Answer for customer:', res.value()));
