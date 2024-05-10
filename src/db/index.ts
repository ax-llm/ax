import { Cloudflare, CloudflareArgs } from './cloudflare.js';
import { MemoryDB, MemoryDBArgs } from './memory.js';
import { Pinecone, PineconeArgs } from './pinecone.js';
import { Weaviate, WeaviateArgs } from './weaviate.js';

export * from './types.js';
export * from './weaviate.js';
export * from './pinecone.js';
export * from './cloudflare.js';
export * from './memory.js';

export type DBName = 'weaviate' | 'pinecone' | 'memory' | 'cloudflare';

export const DB = (
  name: DBName,
  options: Readonly<
    CloudflareArgs | PineconeArgs | WeaviateArgs | MemoryDBArgs
  > = {}
) => {
  switch (name) {
    case 'weaviate':
      return new Weaviate(options as WeaviateArgs);
    case 'pinecone':
      return new Pinecone(options as PineconeArgs);
    case 'cloudflare':
      return new Cloudflare(options as CloudflareArgs);
    case 'memory':
      return new MemoryDB(options as MemoryDBArgs);
  }
  throw new Error(`Unknown DB ${name}`);
};
