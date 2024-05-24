import { apiCall } from '../util/apicall.js';

import { type BaseArgs, BaseDB, type BaseOpOptions } from './base.js';
import type {
  DBQueryRequest,
  DBQueryResponse,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

type WeaviateUpsertResponse = {
  id: string;
  result?: { errors?: { error: { message: string }[] } };
};

type WeaviateQueryResponse = {
  errors?: { location: string; message: string; path: string }[];
  data: {
    Get: {
      [key: string]: {
        [key: string]: unknown;
      }[];
    };
  };
};

export interface WeaviateArgs {
  apiKey: string;
  host: string;
  fetch?: typeof fetch;
}

/**
 * Weaviate: DB Service
 * @export
 */
export class Weaviate extends BaseDB {
  private apiKey: string;
  private apiURL: string;

  constructor({
    apiKey,
    host,
    fetch,
    tracer
  }: Readonly<WeaviateArgs & BaseArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Weaviate API key not set');
    }
    super({ name: 'Weaviate', fetch, tracer });
    this.apiKey = apiKey;
    this.apiURL = host;
  }

  override _upsert = async (
    req: Readonly<DBUpsertRequest>,
    update?: boolean,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBUpsertResponse> => {
    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: `/v1/objects/${req.table}/${req.id}`,
        put: update ? true : false,
        fetch: this.fetch,
        span: options?.span
      },
      {
        id: req.id,
        class: req.table,
        tenant: req.namespace,
        vector: req.values,
        properties: req.metadata ?? {}
      }
    )) as WeaviateUpsertResponse;

    if (res?.result?.errors) {
      throw new Error(
        `Weaviate upsert failed: ${res.result.errors.error
          .map(({ message }) => message)
          .join(', ')}`
      );
    }

    return {
      ids: [res.id]
    };
  };

  override _batchUpsert = async (
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBUpsertResponse> => {
    if (update) {
      throw new Error('Weaviate does not support batch update');
    }
    if (batchReq.length === 0) {
      throw new Error('Batch request is empty');
    }
    const objects = batchReq.map((req) => ({
      id: req.id,
      class: req.table,
      tenant: req.namespace,
      vector: req.values,
      properties: req.metadata ?? {}
    }));

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/v1/batch/objects',
        fetch: this.fetch,
        span: options?.span
      },
      { objects }
    )) as WeaviateUpsertResponse[];

    if (res?.some(({ result }) => result?.errors)) {
      throw new Error(
        `Weaviate batch upsert failed: ${res
          .map(({ result }) =>
            result?.errors?.error.map(({ message }) => message).join(', ')
          )
          .join(', ')}`
      );
    }

    return {
      ids: res.map(({ id }) => id)
    };
  };

  override _query = async (
    req: Readonly<DBQueryRequest>,
    options?: Readonly<BaseOpOptions>
  ): Promise<DBQueryResponse> => {
    let filter = '';

    if (req.columns && req.columns.length === 0) {
      throw new Error('Weaviate requires at least one column');
    }

    if (req.values) {
      filter = `nearVector: {
            vector: [${req.values.join(',')}],
        }`;
    } else if (req.text) {
      filter = `nearText: {
            concepts: ['${req.text}'],
        }`;
    } else {
      throw new Error('Weaviate requires either text or values');
    }

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/v1/graphql',
        fetch: this.fetch,
        span: options?.span
      },
      {
        query: `{
          Get {
            ${req.table} (
              limit: ${req.limit || 10},
              ${filter}
            ) {
                ${req.columns?.join('\n')}
            }
          }
        }`
      }
    )) as WeaviateQueryResponse;

    if (res.errors) {
      throw new Error(
        `Weaviate query failed: ${res.errors
          .map(({ message }) => message)
          .join(', ')}`
      );
    }

    const resMatches = res.data.Get[req.table];

    if (!resMatches) {
      return { matches: [] };
    }

    const matches = resMatches.map((match) => {
      return {
        id: match.id as string,
        score: 1,
        metadata: match
      };
    });
    return { matches } as DBQueryResponse;
  };
}
