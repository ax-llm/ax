import { apiCall } from '../util/apicall.js';

import type {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

// For upsert

// type WeaviateUpsertRequest = {
//   id?: string;
//   class: string;
//   vector?: readonly number[];
//   tenant?: string;
//   properties: Record<string, string>;
// };

type WeaviateUpsertResponse = {
  id: string;
  result?: { errors?: { error: { message: string }[] } };
};

// For query

// type WeaviateQueryRequest = {
//   query: string;
// };

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
}

/**
 * Weaviate: DB Service
 * @export
 */
export class Weaviate implements DBService {
  private apiKey: string;
  private apiURL: string;

  constructor({ apiKey, host }: Readonly<WeaviateArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Weaviate API key not set');
    }
    this.apiKey = apiKey;
    this.apiURL = host;
  }

  async upsert(
    req: Readonly<DBUpsertRequest>,
    update?: boolean
  ): Promise<DBUpsertResponse> {
    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: `/v1/objects/${req.table}/${req.id}`,
        put: update ? true : false
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
  }

  async batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse> {
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
        name: '/v1/batch/objects'
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
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
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
        name: '/v1/graphql'
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

    const matches = res.data.Get[req.table].map((match) => {
      return {
        id: match.id as string,
        score: 1,
        metadata: match
      };
    });
    return { matches } as DBQueryResponse;
  }
}
