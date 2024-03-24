import { AI, ChainOfThought, type OpenAIArgs } from '../index.js';

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const cot = new ChainOfThought(
  ai,
  `
  context:string[] "Information to answer the question",
  question:string
  ->
  answer:string[]`
);

const values = {
  question: 'What is the capital of France?',
  context: [
    'Paris is the capital and most populous city of France. Situated on the Seine River, in the north of the country, it is in the centre of the Île-de-France region, also known as the région parisienne, "Paris Region"',
    'France is a unitary semi-presidential republic with its capital in Paris, the countrys largest city and main cultural and commercial centre; other major '
  ]
};

const res = await cot.forward(values);
console.log(res);
