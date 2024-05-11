import { AIService, DBService } from '../index.js';

// Define interfaces for AI and DB services to ensure type safety
interface DBLoaderOptions {
  chunker?: (text: string) => string[];
}

export class DBManager {
  private ai: AIService;
  private db: DBService;
  private chunker: (text: string) => string[];

  constructor(ai: AIService, db: DBService, config: DBLoaderOptions = {}) {
    this.ai = ai;
    this.db = db;
    this.chunker = config.chunker || this.defaultChunker;
  }

  private defaultChunker = (text: string): string[] => {
    // Default chunking by paragraphs
    return text.split(/\n\n+/);
  };

  insert = async (text: string): Promise<void> => {
    try {
      // Chunk the text using the specified or default chunking function
      const chunks = this.chunker(text);

      // Process chunks in batches of 10
      for (let i = 0; i < chunks.length; i += 10) {
        const batch = chunks.slice(i, i + 10);

        // Get embeddings for the whole batch from the AI service in one call
        const ret = await this.ai.embed({ texts: batch });

        // Prepare batch for bulk upsert
        const embeddings = ret.embeddings.map((embedding, index) => ({
          id: `chunk_${Date.now() + index}`, // Unique ID for each chunk, adjusted by index
          table: 'text_embeddings',
          values: embedding,
          metadata: { text: batch[index] }
        }));

        // Batch upsert embeddings
        await this.db.batchUpsert(embeddings);
      }
    } catch (error) {
      throw new Error(`Error processing text: ${error}`);
    }
  };

  query = async (query: Readonly<string | string[]>) => {
    const texts = Array.isArray(query) ? query : [query];

    // Get embedding for the text
    const ret = await this.ai.embed({ texts });

    // Query the DB for similar embeddings
    const { matches } = await this.db.query({
      table: 'text_embeddings',
      values: ret.embeddings[0]
    });

    return matches;
  };
}
