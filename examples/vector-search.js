import { Anthropic, Cohere, OpenAI } from '@dosco/llm-client';
import { LocalIndex } from 'vectra';

const InitAI = () => {
  if (process.env.COHERE_APIKEY) {
    return new Cohere(process.env.COHERE_APIKEY);
  } else if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.ANTHROPIC_APIKEY) {
    return new Anthropic(process.env.ANTHROPIC_APIKEY);
  }
  throw new Error('No LLM API key found');
};

const ai = InitAI();

const index = new LocalIndex('./index');

async function addItem(text) {
  const res = await ai.embed(text);
  await index.insertItem({ vector: res.embedding, metadata: { text } });
}

if (!(await index.isIndexCreated())) {
  await index.createIndex();

  // Add items
  await addItem('apple');
  await addItem('oranges');
  await addItem('red');
  await addItem('blue');
}

// Query
const query = await ai.embed('fruits');
const results = await index.queryItems(query.embedding, 3);

// Console print the id, value and the match score
console.log(
  results.map(({ item: { id, metadata }, score }) => ({
    id,
    metadata,
    score,
  }))
);
