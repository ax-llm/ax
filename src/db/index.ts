import { AxCloudflare, type AxCloudflareArgs } from './cloudflare.js';
import { AxMemoryDB, type AxMemoryDBArgs } from './memory.js';
import { AxPinecone, type AxPineconeArgs } from './pinecone.js';
import { AxWeaviate, type AxWeaviateArgs } from './weaviate.js';

export * from './types.js';
export * from './weaviate.js';
export * from './pinecone.js';
export * from './cloudflare.js';
export * from './memory.js';

export type AxDBName = 'weaviate' | 'pinecone' | 'memory' | 'cloudflare';

export const axDB = (
  name: AxDBName,
  options: Readonly<
    AxCloudflareArgs | AxPineconeArgs | AxWeaviateArgs | AxMemoryDBArgs
  > = {}
) => {
  switch (name) {
    case 'weaviate':
      return new AxWeaviate(options as AxWeaviateArgs);
    case 'pinecone':
      return new AxPinecone(options as AxPineconeArgs);
    case 'cloudflare':
      return new AxCloudflare(options as AxCloudflareArgs);
    case 'memory':
      return new AxMemoryDB(options as AxMemoryDBArgs);
  }
  throw new Error(`Unknown DB ${name}`);
};
