import { Pinecone } from './pinecone.js';
import { Weaviate } from './weaviate.js';

export * from './types.js';
export * from './weaviate.js';
export * from './pinecone.js';

export const DB = (
  name: string,
  apiKey: string,
  options: Record<string, string>
) => {
  switch (name) {
    case 'weaviate':
      return new Weaviate(apiKey, options.host);
    case 'pinecone':
      return new Pinecone(apiKey, options.host);
  }
  throw new Error(`Unknown DB ${name}`);
};
