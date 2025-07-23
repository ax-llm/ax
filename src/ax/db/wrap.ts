import { AxDBCloudflare, type AxDBCloudflareArgs } from './cloudflare.js';
import { AxDBMemory, type AxDBMemoryArgs } from './memory.js';
import { AxDBPinecone, type AxDBPineconeArgs } from './pinecone.js';
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBService,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js';
import { AxDBWeaviate, type AxDBWeaviateArgs } from './weaviate.js';

export type AxDBArgs =
  | AxDBCloudflareArgs
  | AxDBPineconeArgs
  | AxDBWeaviateArgs
  | AxDBMemoryArgs;

/**
 * The `AxDB` class is a wrapper for various database services, providing a unified interface for upsert and query operations.
 *
 * It uses a factory pattern to instantiate the appropriate database service based on the provided arguments.
 *
 * @example
 * ```typescript
 * import { AxDB } from './ax';
 *
 * const db = new AxDB({
 *   name: 'memory',
 * });
 *
 * await db.upsert({
 *  documents: [
 *   { id: '1', content: 'Hello, world!' },
 *  ],
 * });
 *
 * const results = await db.query({
 *  query: 'hello',
 * });
 * ```
 */
export class AxDB implements AxDBService {
  private db: AxDBService;
  /**
   * Creates an instance of the `AxDB` class.
   * @param {Readonly<AxDBArgs>} args - The configuration arguments for the database service.
   */
  constructor(args: Readonly<AxDBArgs>) {
    switch (args.name) {
      case 'weaviate':
        this.db = new AxDBWeaviate(args);
        break;
      case 'pinecone':
        this.db = new AxDBPinecone(args);
        break;
      case 'cloudflare':
        this.db = new AxDBCloudflare(args);
        break;
      case 'memory':
        this.db = new AxDBMemory(args);
        break;
      default:
        throw new Error('Unknown DB');
    }
  }
  /**
   * Upserts a single document into the database.
   * @param {Readonly<AxDBUpsertRequest>} req - The upsert request.
   * @param {boolean} [update] - Whether to update the document if it already exists.
   * @returns {Promise<AxDBUpsertResponse>} The upsert response.
   */
  async upsert(
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    return await this.db.upsert(req, update);
  }

  /**
   * Upserts a batch of documents into the database.
   * @param {Readonly<AxDBUpsertRequest[]>} batchReq - The batch of upsert requests.
   * @param {boolean} [update] - Whether to update the documents if they already exist.
   * @returns {Promise<AxDBUpsertResponse>} The upsert response.
   */
  async batchUpsert(
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    return await this.db.batchUpsert(batchReq, update);
  }

  /**
   * Queries the database for similar documents.
   * @param {Readonly<AxDBQueryRequest>} req - The query request.
   * @returns {Promise<AxDBQueryResponse>} The query response.
   */
  async query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse> {
    return await this.db.query(req);
  }
}
