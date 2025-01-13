import { AxDBCloudflare, type AxDBCloudflareArgs } from './cloudflare.js'
import { AxDBMemory, type AxDBMemoryArgs } from './memory.js'
import { AxDBPinecone, type AxDBPineconeArgs } from './pinecone.js'
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBService,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js'
import { AxDBWeaviate, type AxDBWeaviateArgs } from './weaviate.js'

export type AxDBArgs =
  | AxDBCloudflareArgs
  | AxDBPineconeArgs
  | AxDBWeaviateArgs
  | AxDBMemoryArgs

export class AxDB implements AxDBService {
  private db: AxDBService
  constructor(args: Readonly<AxDBArgs>) {
    switch (args.name) {
      case 'weaviate':
        this.db = new AxDBWeaviate(args)
        break
      case 'pinecone':
        this.db = new AxDBPinecone(args)
        break
      case 'cloudflare':
        this.db = new AxDBCloudflare(args)
        break
      case 'memory':
        this.db = new AxDBMemory(args)
        break
      default:
        throw new Error(`Unknown DB`)
    }
  }
  async upsert(
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    return await this.db.upsert(req, update)
  }

  async batchUpsert(
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    return await this.db.batchUpsert(batchReq, update)
  }

  async query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse> {
    return await this.db.query(req)
  }
}
