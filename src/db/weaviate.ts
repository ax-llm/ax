import { API, apiCall } from '../util/apicall.js';

import {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse,
} from './types.js';

const enum WeaviateApi {
  GraphQL = '/v1/graphql',
  Upsert = '/v1/objects',
  BatchUpsert = '/v1/batch/objects',
}

// For upsert

type WeaviateUpsertRequest = {
  id?: string;
  class: string;
  vector?: readonly number[];
  tenant?: string;
  properties: Record<string, string>;
};

type WeaviateUpsertResponse = {
  id: string;
  result?: { errors?: { error: { message: string }[] } };
};

// For query

type WeaviateQueryRequest = {
  query: string;
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

/**
 * Weaviate: DB Service
 * @export
 */
export class Weaviate implements DBService {
  private apiKey: string;
  private apiURL: string;

  constructor(apiKey: string, host: string) {
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
    const path = update ? `/${req.table}/${req.id}` : '';

    const res = await apiCall<WeaviateUpsertRequest, WeaviateUpsertResponse>(
      this.createAPI(WeaviateApi.Upsert + path, update),
      {
        id: req.id,
        class: req.table,
        tenant: req.namespace,
        vector: req.values,
        properties: req.metadata ?? {},
      }
    );

    return {
      id: res.id,
      errors: res.result?.errors?.error.map(({ message }) => message),
    };
  }

  async batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse[]> {
    if (update) {
      throw new Error('Weaviate does not support batch update');
    }
    const objects = batchReq.map((req) => ({
      id: req.id,
      class: req.table,
      tenant: req.namespace,
      vector: req.values,
      properties: req.metadata ?? {},
    }));

    const res = await apiCall<
      { objects: WeaviateUpsertRequest[] },
      WeaviateUpsertResponse[]
    >(this.createAPI(WeaviateApi.BatchUpsert), { objects });

    return res.map(({ id, result }) => ({
      id: id,
      errors: result?.errors?.error.map(({ message }) => message),
    }));
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
    let filter = '';

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

    const res = await apiCall<WeaviateQueryRequest, WeaviateQueryResponse>(
      this.createAPI(WeaviateApi.GraphQL),
      {
        query: `{
          Get {
            ${req.table} (
              limit: ${req.limit || 10},
              ${filter}
            ) {
                ${req.columns.join('\n')}
            }
          }
        }`,
      }
    );

    if (res?.errors) {
      throw res.errors;
    }

    const matches = res?.data?.Get[req.table]?.map(
      ({ id, score, ...metadata }) => {
        return { id, score, metadata };
      }
    );

    return { matches } as DBQueryResponse;
  }

  private createAPI(name: Readonly<string>, update = false): API {
    return {
      url: this.apiURL,
      key: this.apiKey,
      name,
      put: update ? true : false,
    };
  }
}
