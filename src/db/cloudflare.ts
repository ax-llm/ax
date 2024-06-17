import { apiCall } from '../util/apicall.js';

import { AxBaseDB, type AxBaseDBArgs, type AxBaseDBOpOptions } from './base.js';
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBUpsertRequest,
  AxDBUpsertResponse
} from './types.js';

const baseURL = 'https://api.cloudflare.com/client/v4/accounts/';

export type AxCloudflareBaseDBArgs = AxBaseDBArgs;
export type AxCloudflareDBOpOptions = AxBaseDBOpOptions;

type AxCloudflareUpsertResponse = {
  success: boolean;
  errors?: { message: string }[];
  result: { ids: string[] };
};

type AxCloudflareQueryResponse = {
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

export interface AxCloudflareArgs {
  apiKey: string;
  accountId: string;
  fetch?: typeof fetch;
}

/**
 * Cloudflare: DB Service
 * @export
 */
export class AxCloudflare extends AxBaseDB {
  private apiKey: string;
  private accountId: string;

  constructor({
    apiKey,
    accountId,
    fetch,
    tracer
  }: Readonly<AxCloudflareArgs & AxCloudflareBaseDBArgs>) {
    if (!apiKey || !accountId) {
      throw new Error('Cloudflare credentials not set');
    }
    super({ name: 'Cloudflare', fetch, tracer });
    this.apiKey = apiKey;
    this.accountId = accountId;
  }

  override _upsert = async (
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean,
    options?: Readonly<AxCloudflareDBOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    const res = (await apiCall(
      {
        url: new URL(
          `${this.accountId}/vectorize/indexes/${req.table}/upsert`,
          baseURL
        ),
        headers: {
          'X-Auth-Key': this.apiKey
        },
        fetch: this.fetch,
        span: options?.span
      },
      {
        id: req.id,
        values: req.values,
        namespace: req.namespace,
        metadata: req.metadata
      }
    )) as AxCloudflareUpsertResponse;

    if (res.errors) {
      throw new Error(
        `Cloudflare upsert failed: ${res.errors.map(({ message }) => message).join(', ')}`
      );
    }

    return {
      ids: res.result.ids
    };
  };

  override batchUpsert = async (
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean,
    options?: Readonly<AxCloudflareDBOpOptions>
  ): Promise<AxDBUpsertResponse> => {
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
        fetch: this.fetch,
        span: options?.span
      },
      batchReq.map((req) => ({
        id: req.id,
        values: req.values,
        namespace: req.namespace,
        metadata: req.metadata
      }))
    )) as AxCloudflareUpsertResponse;

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
  };

  override query = async (
    req: Readonly<AxDBQueryRequest>,
    options?: Readonly<AxCloudflareDBOpOptions>
  ): Promise<AxDBQueryResponse> => {
    const res = (await apiCall(
      {
        url: new URL(
          `${this.accountId}/vectorize/indexes/${req.table}/query`,
          baseURL
        ),
        headers: {
          'X-Auth-Key': this.apiKey
        },
        fetch: this.fetch,
        span: options?.span
      },
      {
        vector: req.values,
        topK: req.limit || 10,
        returnValues: true
      }
    )) as AxCloudflareQueryResponse;

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
    return { matches } as AxDBQueryResponse;
  };
}
