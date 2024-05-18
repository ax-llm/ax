import { apiCall } from '../util/apicall.js';

import type {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

// For upsert

// type PineconeUpsertRequest = {
//   id: string;
//   values: readonly number[];
//   metadata?: Record<string, string>;
// };

// type PineconeUpsertResponse = {
//   upsertedCount: number;
// };

// For query

type PineconeQueryRequest = {
  namespace?: string;
  topK: number;
  filter?: Record<string, string>;
  includeValues: boolean;
  includeMetadata: boolean;
  vector: readonly number[];
  id?: string;
};

type PineconeQueryResponse = {
  matches: {
    id: string;
    score: number;
    values: number[];
    metadata?: Record<string, string>;
  }[];
};

const createPineconeQueryRequest = (
  req: Readonly<DBQueryRequest>
): PineconeQueryRequest => {
  const pineconeQueryRequest: PineconeQueryRequest = {
    namespace: req.namespace,
    topK: req.limit || 10,
    filter: {},
    includeValues: true,
    includeMetadata: true,
    vector: req.values ?? [],
    id: req.id
  };

  return pineconeQueryRequest;
};

export interface PineconeArgs {
  apiKey: string;
  host: string;
  fetch?: typeof fetch;
}

/**
 * Pinecone: DB Service
 * @export
 */
export class Pinecone implements DBService {
  private apiKey: string;
  private apiURL: string;
  private fetch?: typeof fetch;

  constructor({ apiKey, host, fetch }: Readonly<PineconeArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Pinecone API key not set');
    }
    this.apiKey = apiKey;
    this.apiURL = host;
    this.fetch = fetch;
  }

  async upsert(req: Readonly<DBUpsertRequest>): Promise<DBUpsertResponse> {
    await this.batchUpsert([req]);
    return { ids: [req.id] };
  }

  async batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>
  ): Promise<DBUpsertResponse> {
    if (batchReq.length === 0) {
      throw new Error('Batch request is empty');
    }
    await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/vectors/upsert',
        fetch: this.fetch
      },
      batchReq.map(({ id, values = [], metadata }) => ({
        id,
        values,
        metadata
      }))
    );

    return { ids: batchReq.map(({ id }) => id) };
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
    if (req.text) {
      throw new Error('Pinecone does not support text');
    }

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/query',
        fetch: this.fetch
      },
      createPineconeQueryRequest(req)
    )) as PineconeQueryResponse;

    const matches = res.matches.map(({ id, score, values, metadata }) => ({
      id,
      score,
      metadata,
      values
    }));

    return { matches };
  }
}
