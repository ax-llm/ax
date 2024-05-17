import type { AIService, DBQueryResponse, DBService } from '../index.js';

export interface DBLoaderOptions {
  chunker?: (text: string) => string[];
}

export interface DBManagerArgs {
  ai: AIService;
  db: DBService;
  config?: DBLoaderOptions;
}

export interface Match {
  score: number;
  text: string;
}

const table = 'text_embeddings';

export class DBManager {
  private ai: AIService;
  private db: DBService;
  private chunker: (text: string) => string[];

  constructor({ ai, db, config }: Readonly<DBManagerArgs>) {
    this.ai = ai;
    this.db = db;
    this.chunker = config?.chunker ?? this.defaultChunker;
  }

  private defaultChunker = (text: string): string[] => {
    // Default chunking by paragraphs
    return text.split(/\n\n+/);
  };

  insert = async (
    text: Readonly<string | string[]>,
    options?: Readonly<{
      batchSize?: number;
      maxWordsPerChunk?: number;
      overagePercentage?: number;
    }>
  ): Promise<void> => {
    try {
      const chunkerInput = Array.isArray(text)
        ? text.join('\n\n')
        : (text as string);

      // Chunk the text using the specified or default chunking function
      const initialChunks = this.chunker(chunkerInput).filter(
        (chunk) => chunk.length > 0
      );

      const minChunkSize = options?.maxWordsPerChunk ?? 1000;
      const overagePercentage = options?.overagePercentage ?? 0.1;

      const chunks = processChunks(
        initialChunks,
        minChunkSize,
        overagePercentage
      );

      const bs = options?.batchSize ?? 10;

      // Process chunks in batches of 10
      for (let i = 0; i < chunks.length; i += bs) {
        const batch = chunks.slice(i, i + bs);

        // Get embeddings for the whole batch from the AI service in one call
        const ret = await this.ai.embed({ texts: batch });

        // Prepare batch for bulk upsert
        const embeddings = ret.embeddings
          .map((embedding, index) => ({
            id: `chunk_${Date.now() + index}`, // Unique ID for each chunk, adjusted by index
            table,
            values: embedding,
            metadata: { text: batch[index] ?? '' }
          }))
          .filter((v) => v.metadata?.text && v.metadata?.text.length > 0);

        // Batch upsert embeddings
        await this.db.batchUpsert(embeddings);
      }
    } catch (error) {
      throw new Error(`Error processing text: ${error}`);
    }
  };

  query = async (
    query: Readonly<string | string[] | number | number[]>,
    { topPercent }: Readonly<{ topPercent?: number }> | undefined = {}
  ): Promise<Match[][]> => {
    const texts = Array.isArray(query) ? query : [query];

    let queries: Promise<DBQueryResponse>[];

    if (typeof texts[0] === 'string') {
      const embedResults = await this.ai.embed({ texts });
      queries = embedResults.embeddings.map((values) =>
        this.db.query({ table, values })
      );
    } else {
      queries = texts.map((values) => this.db.query({ table, values }));
    }

    const queryResults = await Promise.all(queries);

    const res = queryResults.map(({ matches }) => {
      const m = matches
        .filter((v) => v.metadata?.text && v.metadata?.text.length > 0)
        .map(({ score, metadata }) => ({ score, text: metadata?.text ?? '' }));

      const tp = topPercent && topPercent > 1 ? topPercent / 100 : topPercent;
      return tp ? getTopInPercent(m, tp) : m;
    });

    return res;
  };
}

const processChunks = (
  initialChunks: readonly string[],
  maxWordsPerChunk: number = 300,
  overagePercentage: number = 0.1
): string[] => {
  const chunks = [];
  const minChunkSize = maxWordsPerChunk ?? 1000; // Minimum number of words per chunk
  const maxChunkSize = minChunkSize + minChunkSize * overagePercentage; // Allowing for a % increase

  let currentChunk = '';
  let currentWordCount = 0;

  initialChunks.forEach((chunk) => {
    const words = chunk.split(/\s+/); // Split the chunk into words
    const wordCount = words.length; // Count words in the current chunk

    if (currentWordCount + wordCount <= maxChunkSize) {
      // Add to the current chunk if within the max size limit, including 10% buffer
      currentChunk += chunk + '\n\n';
      currentWordCount += wordCount;
    } else {
      // If the current chunk is not empty and adding the new chunk exceeds the max size
      if (currentWordCount > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
        currentWordCount = 0;
      }
      // Handle the case where the chunk itself is larger than maxChunkSize or exactly the size
      if (wordCount >= minChunkSize) {
        if (wordCount <= maxChunkSize) {
          chunks.push(chunk);
        } else {
          // Split further if the single chunk is larger than maxChunkSize
          const remainingWords = words;
          while (remainingWords.length > 0) {
            const slice = remainingWords.splice(0, maxChunkSize);
            chunks.push(slice.join(' '));
          }
        }
      } else {
        currentChunk = chunk + '\n\n';
        currentWordCount = wordCount;
      }
    }
  });

  // Push the last chunk if it exists
  if (currentWordCount > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
};

const getTopInPercent = (
  entries: readonly Match[],
  percent: number = 0.1
): Match[] => {
  // Sort entries by score in ascending order
  const sortedEntries = [...entries].sort((a, b) => a.score - b.score);

  // Calculate the number of entries to take (top 10%)
  const topTenPercentCount = Math.ceil(sortedEntries.length * percent);

  // Return the top 10% of entries
  return sortedEntries.slice(0, topTenPercentCount);
};
