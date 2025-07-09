import fs from 'node:fs';
import { AxAI, AxApacheTika, AxDBManager, AxDBMemory } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

const db = new AxDBMemory();

const tika = new AxApacheTika();

const readme = await fs.promises.readFile('./README.md', 'utf-8');

const text = await tika.convert([new Blob([readme], { type: 'text/plain' })]);

const manager = new AxDBManager({ ai, db });
await manager.insert(text, {
  minWordsPerChunk: 50,
  maxWordsPerChunk: 100,
});

const matches = await manager.query('Explain semantic routing');
const topMatch = matches.at(0);

console.log(topMatch);
