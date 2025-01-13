// For upsert

export type AxDBUpsertRequest = {
  id: string
  text?: string
  values?: readonly number[]
  metadata?: Record<string, string>
  table: string
  namespace?: string
}

export type AxDBUpsertResponse = {
  ids: string[]
}

// For query
export type AxDBQueryRequest = {
  id?: string
  text?: string
  values?: readonly number[]
  table: string
  columns?: string[]
  limit?: number
  namespace?: string
}

export type AxDBQueryResponse = {
  matches: {
    id: string
    score: number
    metadata?: Record<string, string>
    table?: string
  }[]
}

export interface AxDBService extends AxDBQueryService {
  upsert(
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean
  ): Promise<AxDBUpsertResponse>

  batchUpsert(
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean
  ): Promise<AxDBUpsertResponse>
}

export interface AxDBQueryService {
  query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse>
}
