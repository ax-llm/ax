import { apiCall } from '../util/apicall.js';

import type {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

const baseURL = 'https://api.cloudflare.com/client/v4/accounts/';

type CloudflareUpsertResponse = {
  success: boolean;
  errors?: { message: string }[];
  result: { ids: string[] };
};

type CloudflareQueryResponse = {
  success: boolean;
  errors?: { message: string }[];
  result: {
    matches: {
      id: string;
      score: number;
      values: number[];
      metadata: object;
    }[];
  };
};

export interface CloudflareArgs {
  apiKey: string;
  accountId: string;
  fetch?: typeof fetch;
}

/**
 * Cloudflare: DB Service
 * @export
 */
export class Cloudflare implements DBService {
  private apiKey: string;
  private accountId: string;
  private fetch?: typeof fetch;

  constructor({ apiKey, accountId, fetch }: Readonly<CloudflareArgs>) {
    if (!apiKey || !accountId) {
      throw new Error('Cloudflare credentials not set');
    }
    this.apiKey = apiKey;
    this.accountId = accountId;
    this.fetch = fetch;
  }

  async upsert(
    req: Readonly<DBUpsertRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _update?: boolean
  ): Promise<DBUpsertResponse> {
    const res = (await apiCall(
      {
        url: new URL(
          `${this.accountId}/vectorize/indexes/${req.table}/upsert`,
          baseURL
        ),
        headers: {
          'X-Auth-Key': this.apiKey
        },
        fetch: this.fetch
      },
      {
        id: req.id,
        values: req.values,
        namespace: req.namespace,
        metadata: req.metadata
      }
    )) as CloudflareUpsertResponse;

    if (res.errors) {
      throw new Error(
        `Cloudflare upsert failed: ${res.errors.map(({ message }) => message).join(', ')}`
      );
    }

    return {
      ids: res.result.ids
    };
  }

  async batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse> {
    if (update) {
      throw new Error('Weaviate does not support batch update');
    }
    if (batchReq.length < 1) {
      throw new Error('Batch request is empty');
    }
    if (!batchReq[0] || !batchReq[0].table) {
      throw new Error('Table name is empty');
    }
    const table = batchReq[0].table;

    const res = (await apiCall(
      {
        url: new URL(
          `${this.accountId}/vectorize/indexes/${table}/upsert`,
          baseURL
        ),
        headers: {
          'X-Auth-Key': this.apiKey
        },
        fetch: this.fetch
      },
      batchReq.map((req) => ({
        id: req.id,
        values: req.values,
        namespace: req.namespace,
        metadata: req.metadata
      }))
    )) as CloudflareUpsertResponse;

    if (res.errors) {
      throw new Error(
        `Cloudflare batch upsert failed: ${res.errors
          .map(({ message }) => message)
          .join(', ')}`
      );
    }

    return {
      ids: res.result.ids
    };
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
    const res = (await apiCall(
      {
        url: new URL(
          `${this.accountId}/vectorize/indexes/${req.table}/query`,
          baseURL
        ),
        headers: {
          'X-Auth-Key': this.apiKey
        },
        fetch: this.fetch
      },
      {
        vector: req.values,
        topK: req.limit || 10,
        returnValues: true
      }
    )) as CloudflareQueryResponse;

    if (res.errors) {
      throw new Error(
        `Cloudflare query failed: ${res.errors.map(({ message }) => message).join(', ')}`
      );
    }

    const matches = res.result.matches.map(
      ({ id, score, values, metadata }) => ({
        id,
        score,
        values,
        metadata
      })
    );
    return { matches } as DBQueryResponse;
  }
}
