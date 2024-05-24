import { apiCall } from '../util/apicall.js';

import { type BaseArgs, BaseDB, type BaseOpOptions } from './base.js';
import type {
  DBQueryRequest,
  DBQueryResponse,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

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
export class Pinecone extends BaseDB {
  private apiKey: string;
  private apiURL: string;

  constructor({
    apiKey,
    host,
    fetch,
    tracer
  }: Readonly<PineconeArgs & BaseArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Pinecone API key not set');
    }
    super({ name: 'Pinecone', fetch, tracer });
    this.apiKey = apiKey;
    this.apiURL = host;
  }

  override _upsert = async (
    req: Readonly<DBUpsertRequest>,
    update?: boolean,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBUpsertResponse> => {
    await this._batchUpsert([req], update, options);
    return { ids: [req.id] };
  };

  override _batchUpsert = async (
    batchReq: Readonly<DBUpsertRequest[]>,
    _update?: boolean,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBUpsertResponse> => {
    if (batchReq.length === 0) {
      throw new Error('Batch request is empty');
    }
    await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/vectors/upsert',
        fetch: this.fetch,
        span: options?.span
      },
      batchReq.map(({ id, values = [], metadata }) => ({
        id,
        values,
        metadata
      }))
    );

    return { ids: batchReq.map(({ id }) => id) };
  };

  override query = async (
    req: Readonly<DBQueryRequest>,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBQueryResponse> => {
    if (req.text) {
      throw new Error('Pinecone does not support text');
    }

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/query',
        fetch: this.fetch,
        span: options?.span
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
  };
}
