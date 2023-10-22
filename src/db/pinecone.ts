import { apiCall } from '../util/apicall.js';

import {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

// For upsert

type PineconeUpsertRequest = {
  id: string;
  values: readonly number[];
  metadata?: Record<string, string>;
};

type PineconeUpsertResponse = {
  upsertedCount: number;
};

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

/**
 * Pinecone: DB Service
 * @export
 */
export class Pinecone implements DBService {
  private apiKey: string;
  private apiURL: string;

  constructor(apiKey: string, host: string) {
    if (!apiKey || apiKey === '') {
      throw new Error('Pinecone API key not set');
    }
    this.apiKey = apiKey;
    this.apiURL = host;
  }

  async upsert(req: Readonly<DBUpsertRequest>): Promise<DBUpsertResponse> {
    const res = await this.batchUpsert([req]);
    return res[0];
  }

  async batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>
  ): Promise<DBUpsertResponse[]> {
    await apiCall<PineconeUpsertRequest[], PineconeUpsertResponse[]>(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/vectors/upsert'
      },
      batchReq.map(({ id, values = [], metadata }) => ({
        id,
        values,
        metadata
      }))
    );

    return batchReq.map(({ id }) => ({ id }));
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
    if (req.text) {
      throw new Error('Pinecone does not support text');
    }

    const res = await apiCall<PineconeQueryRequest, PineconeQueryResponse>(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/query'
      },
      createPineconeQueryRequest(req)
    );

    const matches = res?.matches?.map(({ id, score, metadata }) => {
      return { id, score, metadata };
    });

    return { matches };
  }
}
