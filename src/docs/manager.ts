import {
  type AIService,
  type DBQueryResponse,
  type DBService,
  type Program
} from '../index.js';

export type RewriteIn = { query: string };
export type RewriteOut = { rewrittenQuery: string };

export type RerankerIn = { query: string; items: string[] };
export type RerankerOut = { items: string[] };

export interface DBLoaderOptions {
  chunker?: (text: string) => string[];
  rewriter?: Program<RewriteIn, RewriteOut>;
  reranker?: Program<RerankerIn, RerankerOut>;
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

const table = '_internal';

export class DBManager {
  private ai: AIService;
  private db: DBService;
  private chunker: (text: string) => string[];
  private rewriter?: Program<RewriteIn, RewriteOut>;
  private reranker?: Program<RerankerIn, RerankerOut>;

  constructor({ ai, db, config }: Readonly<DBManagerArgs>) {
    this.ai = ai;
    this.db = db;
    this.chunker = config?.chunker ?? this.defaultChunker;
    this.reranker = config?.reranker;
    this.rewriter = config?.rewriter;
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
      minWordsPerChunk?: number;
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

      const maxWordsPerChunk = options?.maxWordsPerChunk;
      const minWordsPerChunk = options?.minWordsPerChunk;

      const chunks = processChunks({
        initialChunks,
        minWordsPerChunk,
        maxWordsPerChunk
      });

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

    if (typeof texts[0] === 'string' && this.rewriter) {
      for (const [i, text] of texts.entries()) {
        const { rewrittenQuery } = await this.rewriter.forward({
          query: text
        });
        texts[i] = rewrittenQuery;
      }
    }

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
    const res: Match[][] = [];

    for (const { matches } of queryResults) {
      const m = matches
        .filter((v) => v.metadata?.text && v.metadata?.text.length > 0)
        .map(({ score, metadata }) => ({ score, text: metadata?.text ?? '' }));

      const tp = topPercent && topPercent > 1 ? topPercent / 100 : topPercent;
      const resultItems = tp ? getTopInPercent(m, tp) : m;

      if (this.reranker) {
        const { items } = await this.reranker.forward({
          query: texts[0] as string,
          items: resultItems.map((item) => item.text)
        });

        const rankedItems = items
          .map((item) => resultItems.find((r) => r.text === item))
          .filter((v) => v !== undefined) as Match[];

        res.push(rankedItems);
      } else {
        res.push(resultItems);
      }
    }

    return res;
  };
}

const processChunks = ({
  initialChunks,
  maxWordsPerChunk = 350,
  minWordsPerChunk = 250
}: Readonly<{
  initialChunks: readonly string[];
  maxWordsPerChunk?: number;
  minWordsPerChunk?: number;
}>): string[] => {
  const chunks: string[] = [];

  let currentChunk = '';
  let currentWordCount = 0;

  initialChunks.forEach((chunk) => {
    const words = chunk.split(/\s+/); // Split the chunk into words
    const wordCount = words.length; // Count words in the current chunk

    if (currentWordCount + wordCount <= maxWordsPerChunk) {
      // Add to the current chunk if within the max size limit
      currentChunk += chunk + '\n\n';
      currentWordCount += wordCount;
    } else if (
      currentWordCount > 0 &&
      currentWordCount + wordCount <= maxWordsPerChunk * 1.5
    ) {
      // If the total word count exceeds the limit but is less than 150% of the maxWordsPerChunk
      currentChunk += chunk + '\n\n';
      currentWordCount += wordCount;
    } else {
      // If the current chunk is not empty and adding the new chunk exceeds the adjusted limit
      if (currentWordCount > minWordsPerChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentWordCount = 0;
      }
      // Handle the case where the chunk itself is larger than the limit
      if (wordCount > maxWordsPerChunk) {
        const remainingWords = words;
        while (remainingWords.length > maxWordsPerChunk * 1.5) {
          const slice = remainingWords.splice(0, maxWordsPerChunk);
          chunks.push(slice.join(' '));
        }
        // Add the last portion if it fits the condition of being within 150% of maxWordsPerChunk
        if (remainingWords.length > 0) {
          currentChunk += remainingWords.join(' ') + '\n\n';
          currentWordCount += remainingWords.length;
        }
      } else {
        // If the new chunk is smaller than the maximum words per chunk
        currentChunk = chunk + '\n\n';
        currentWordCount = wordCount;
      }
    }
  });

  // Push the last chunk if it exists and meets the minimum words condition
  if (currentWordCount > minWordsPerChunk || chunks.length === 0) {
    chunks.push(currentChunk.trim());
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
