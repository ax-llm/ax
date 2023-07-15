import { Together, Cohere, OpenAI } from '@dosco/llm-client';

export const InitAI = () => {
  if (process.env.COHERE_APIKEY) {
    return new Cohere(process.env.COHERE_APIKEY);
  } else if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.TOGETHER_APIKEY) {
    return new Together(process.env.TOGETHER_APIKEY);
  }
  throw new Error('No LLM API key found');
};
