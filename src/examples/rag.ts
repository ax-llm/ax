import { AI, ChainOfThought, type OpenAIArgs, RAG } from '../index.js';

// simulated vector db call using an llm
const fetchFromVectorDB = async (query: string) => {
  const cot = new ChainOfThought<{ query: string }, { answer: string }>(
    ai,
    'query -> answer'
  );
  const { answer } = await cot.forward({ query });
  return answer;
};

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const rag = new RAG(ai, fetchFromVectorDB, { maxHops: 3 });

const res = await rag.forward({
  question: 'List 3 of the top most important work done by Michael Stonebraker?'
});

console.log(res);
