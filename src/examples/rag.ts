import { OpenAI, OpenAIArgs, RAG, TextResponse } from '../index.js';
import 'dotenv/config';

const ai = new OpenAI({ apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const rag = new RAG(
  ai,
  async (query) => {
    const ret = (await ai.chat({
      chatPrompt: [{ role: 'user', content: query }]
    })) as unknown as TextResponse;
    const result = ret.results?.at(0)?.content;

    if (!result) {
      throw new Error('No result found');
    }

    return result;
  },
  { maxHops: 3 }
);

const values = {
  question: 'List 3 of the top most important work done by Michael Stonebraker?'
};

const res = await rag.forward(values);
console.log(res);
