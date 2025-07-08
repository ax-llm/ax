import { AxAI, AxChainOfThought } from '@ax-llm/ax';

const cot = new AxChainOfThought(
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
    'France is a unitary semi-presidential republic with its capital in Paris, the countrys largest city and main cultural and commercial centre; other major ',
  ],
};

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

// const ai = new AxAI({
//   name: 'ollama',
//   config: { stream: false }
// });

// const ai = new AxAI({
//   name: 'google-gemini',
//   apiKey: process.env.GOOGLE_APIKEY as string,
//   config: { model: AxAIGoogleGeminiModel.Gemini15Flash8B, stream: false },
// })

ai.setOptions({ debug: true });

const res = await cot.forward(ai, values);
console.log(res);

console.log(ai.getMetrics());
