import { AxAI, AxChainOfThought } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

ai.setOptions({ debug: true });

const cot = new AxChainOfThought(
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

async function run() {
  const res = await cot.forward(values);
  console.log(res);
}

run().catch(console.error);
