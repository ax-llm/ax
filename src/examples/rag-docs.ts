import {
  AI,
  ApacheTika,
  DBManager,
  MemoryDB,
  type OpenAIArgs
} from '../index.js';

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const db = new MemoryDB();

const tika = new ApacheTika();
const text = await tika.convert(['./README.md']);

const manager = new DBManager({ ai, db });
await manager.insert(text, { maxWordsPerChunk: 50 });

const matches = await manager.query('Explain semantic routing');
const topMatch = matches.at(0);

console.log(topMatch);
