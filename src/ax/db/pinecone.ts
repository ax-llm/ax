import { apiCall } from '../util/apicall.js'

import { AxDBBase, type AxDBBaseArgs, type AxDBBaseOpOptions } from './base.js'
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js'

export type AxDBPineconeOpOptions = AxDBBaseOpOptions

type AxPineconeQueryRequest = {
  namespace?: string
  topK: number
  filter?: Record<string, string>
  includeValues: boolean
  includeMetadata: boolean
  vector: readonly number[]
  id?: string
}

type AxPineconeQueryResponse = {
  matches: {
    id: string
    score: number
    values: number[]
    metadata?: Record<string, string>
  }[]
}

const createPineconeQueryRequest = (
  req: Readonly<AxDBQueryRequest>
): AxPineconeQueryRequest => {
  const pineconeQueryRequest: AxPineconeQueryRequest = {
    namespace: req.namespace,
    topK: req.limit || 10,
    filter: {},
    includeValues: true,
    includeMetadata: true,
    vector: req.values ?? [],
    id: req.id,
  }

  return pineconeQueryRequest
}

export interface AxDBPineconeArgs extends AxDBBaseArgs {
  name: 'pinecone'
  apiKey: string
  host: string
  fetch?: typeof fetch
}

/**
 * Pinecone: DB Service
 */
export class AxDBPinecone extends AxDBBase {
  private apiKey: string
  private apiURL: string

  constructor({
    apiKey,
    host,
    fetch,
    tracer,
  }: Readonly<Omit<AxDBPineconeArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Pinecone API key not set')
    }
    super({ name: 'Pinecone', fetch, tracer })
    this.apiKey = apiKey
    this.apiURL = host
  }

  override _upsert = async (
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean,
    options?: Readonly<AxDBPineconeOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    await this._batchUpsert([req], update, options)
    return { ids: [req.id] }
  }

  override _batchUpsert = async (
    batchReq: Readonly<AxDBUpsertRequest[]>,
    _update?: boolean,
    options?: Readonly<AxDBPineconeOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    if (batchReq.length === 0) {
      throw new Error('Batch request is empty')
    }
    await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/vectors/upsert',
        fetch: this.fetch,
        span: options?.span,
      },
      batchReq.map(({ id, values = [], metadata }) => ({
        id,
        values,
        metadata,
      }))
    )

    return { ids: batchReq.map(({ id }) => id) }
  }

  override query = async (
    req: Readonly<AxDBQueryRequest>,
    options?: Readonly<AxDBPineconeOpOptions>
  ): Promise<AxDBQueryResponse> => {
    if (req.text) {
      throw new Error('Pinecone does not support text')
    }

    const res = (await apiCall(
      {
        url: this.apiURL,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        name: '/query',
        fetch: this.fetch,
        span: options?.span,
      },
      createPineconeQueryRequest(req)
    )) as AxPineconeQueryResponse

    const matches = res.matches.map(({ id, score, values, metadata }) => ({
      id,
      score,
      metadata,
      values,
    }))

    return { matches }
  }
}
