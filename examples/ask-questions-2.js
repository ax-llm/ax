import {
  Cohere,
  OpenAI,
  Memory,
  GenerateText,
  QuestionAnswerPrompt,
} from 'minds';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY);

// Fake search action to simulate a product database search
const productSearch = (_text) => {
  return `
  Name: Macbook Pro M2
  Details: Ram 32GB
  In Stock: True
  --
  Name: Macbook Pro M2
  Details: Ram 96GB
  In Stock: False`;
};

// List of actions available to the AI
const actions = [
  {
    name: 'Product Search',
    description: 'Used to search up a products information by its name',
    action: productSearch,
  },
];

const mem = new Memory();
const prompt = new QuestionAnswerPrompt(actions);
const gen = new GenerateText(ai, mem);
gen.setDebug(true);

const res = await gen.generate(
  `Do we have the product the email referes to in stock? 
  Email: I'm looking for a Macbook Pro M2 With 96GB RAM.`,
  prompt
);

console.log('>', res.value);
