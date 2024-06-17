import {
  axAI,
  AxApacheTika,
  AxDBManager,
  AxMemoryDB,
  type AxOpenAIArgs
} from '../index.js';

const ai = axAI('openai', {
  apiKey: process.env.OPENAI_APIKEY
} as AxOpenAIArgs);
const db = new AxMemoryDB();

const tika = new AxApacheTika();
const text = await tika.convert(['./README.md']);

const manager = new AxDBManager({ ai, db });
await manager.insert(text, {
  minWordsPerChunk: 50,
  maxWordsPerChunk: 100
});

const matches = await manager.query('Explain semantic routing');
const topMatch = matches.at(0);

console.log(topMatch);
