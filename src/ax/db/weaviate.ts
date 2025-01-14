import { apiCall } from '../util/apicall.js'

import { AxDBBase, type AxDBBaseArgs, type AxDBBaseOpOptions } from './base.js'
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js'

export type AxDBWeaviateOpOptions = AxDBBaseOpOptions

type AxWeaviateUpsertResponse = {
  id: string
  result?: { errors?: { error: { message: string }[] } }
}

type AxWeaviateQueryResponse = {
  errors?: { location: string; message: string; path: string }[]
  data: {
    Get: {
      [key: string]: {
        [key: string]: unknown
      }[]
    }
  }
}

export interface AxDBWeaviateArgs extends AxDBBaseArgs {
  name: 'weaviate'
  apiKey: string
  host: string
  fetch?: typeof fetch
}

/**
 * Weaviate: DB Service
 */
export class AxDBWeaviate extends AxDBBase {
  private apiKey: string
  private apiURL: string

  constructor({
    apiKey,
    host,
    fetch,
    tracer,
  }: Readonly<Omit<AxDBWeaviateArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Weaviate API key not set')
    }
    super({ name: 'Weaviate', fetch, tracer })
    this.apiKey = apiKey
    this.apiURL = host
  }

  override _upsert = async (
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean,
    options?: Readonly<AxDBWeaviateOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: `/v1/objects/${req.table}/${req.id}`,
        put: update ? true : false,
        fetch: this.fetch,
        span: options?.span,
      },
      {
        id: req.id,
        class: req.table,
        tenant: req.namespace,
        vector: req.values,
        properties: req.metadata ?? {},
      }
    )) as AxWeaviateUpsertResponse

    if (res?.result?.errors) {
      throw new Error(
        `Weaviate upsert failed: ${res.result.errors.error
          .map(({ message }) => message)
          .join(', ')}`
      )
    }

    return {
      ids: [res.id],
    }
  }

  override _batchUpsert = async (
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean,
    options?: Readonly<AxDBWeaviateOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    if (update) {
      throw new Error('Weaviate does not support batch update')
    }
    if (batchReq.length === 0) {
      throw new Error('Batch request is empty')
    }
    const objects = batchReq.map((req) => ({
      id: req.id,
      class: req.table,
      tenant: req.namespace,
      vector: req.values,
      properties: req.metadata ?? {},
    }))

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/v1/batch/objects',
        fetch: this.fetch,
        span: options?.span,
      },
      { objects }
    )) as AxWeaviateUpsertResponse[]

    if (res?.some(({ result }) => result?.errors)) {
      throw new Error(
        `Weaviate batch upsert failed: ${res
          .map(({ result }) =>
            result?.errors?.error.map(({ message }) => message).join(', ')
          )
          .join(', ')}`
      )
    }

    return {
      ids: res.map(({ id }) => id),
    }
  }

  override _query = async (
    req: Readonly<AxDBQueryRequest>,
    options?: Readonly<AxDBWeaviateOpOptions>
  ): Promise<AxDBQueryResponse> => {
    let filter = ''

    if (req.columns && req.columns.length === 0) {
      throw new Error('Weaviate requires at least one column')
    }

    if (req.values) {
      filter = `nearVector: {
            vector: [${req.values.join(',')}],
        }`
    } else if (req.text) {
      filter = `nearText: {
            concepts: ['${req.text}'],
        }`
    } else {
      throw new Error('Weaviate requires either text or values')
    }

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/v1/graphql',
        fetch: this.fetch,
        span: options?.span,
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
        }`,
      }
    )) as AxWeaviateQueryResponse

    if (res.errors) {
      throw new Error(
        `Weaviate query failed: ${res.errors
          .map(({ message }) => message)
          .join(', ')}`
      )
    }

    const resMatches = res.data.Get[req.table]

    if (!resMatches) {
      return { matches: [] }
    }

    const matches = resMatches.map((match) => {
      return {
        id: match['id'] as string,
        score: 1,
        metadata: match,
      }
    })
    return { matches } as AxDBQueryResponse
  }
}
