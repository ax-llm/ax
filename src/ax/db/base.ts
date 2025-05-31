import { type Span, SpanKind, type Tracer } from '@opentelemetry/api'

import { axSpanAttributes } from '../trace/trace.js'

import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBService,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js'

export interface AxDBBaseArgs {
  fetch?: typeof fetch
  tracer?: Tracer
}

export interface AxDBBaseOpOptions {
  span?: Span
}

export class AxDBBase implements AxDBService {
  protected name: string
  protected fetch?: typeof fetch
  private tracer?: Tracer

  _upsert?: (
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean,
    options?: Readonly<AxDBBaseOpOptions>
  ) => Promise<AxDBUpsertResponse>

  _batchUpsert?: (
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean,
    options?: Readonly<AxDBBaseOpOptions>
  ) => Promise<AxDBUpsertResponse>

  _query?: (
    req: Readonly<AxDBQueryRequest>,
    options?: Readonly<AxDBBaseOpOptions>
  ) => Promise<AxDBQueryResponse>

  constructor({
    name,
    fetch,
    tracer,
  }: Readonly<AxDBBaseArgs & { name: string }>) {
    this.name = name
    this.fetch = fetch
    this.tracer = tracer
  }

  async upsert(
    req: Readonly<AxDBUpsertRequest>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    if (!this._upsert) {
      throw new Error('upsert() not implemented')
    }

    if (!this.tracer) {
      return await this._upsert(req, update)
    }

    return await this.tracer.startActiveSpan(
      'DB Upsert Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [axSpanAttributes.DB_SYSTEM]: this.name,
          [axSpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [axSpanAttributes.DB_TABLE]: req.table,
          [axSpanAttributes.DB_NAMESPACE]: req.namespace,
          [axSpanAttributes.DB_OPERATION_NAME]: update ? 'update' : 'insert',
        },
      },
      async (span) => {
        try {
          return await this._upsert!(req, update, { span })
        } finally {
          span.end()
        }
      }
    )
  }

  async batchUpsert(
    req: Readonly<AxDBUpsertRequest[]>,
    update?: boolean
  ): Promise<AxDBUpsertResponse> {
    if (!this._batchUpsert) {
      throw new Error('batchUpsert() not implemented')
    }
    if (req.length == 0) {
      throw new Error('Batch request is empty')
    }
    if (!req[0]) {
      throw new Error('Batch request is invalid first element is undefined')
    }

    if (!this.tracer) {
      return await this._batchUpsert(req, update)
    }

    return await this.tracer.startActiveSpan(
      'DB Batch Upsert Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [axSpanAttributes.DB_SYSTEM]: this.name,
          [axSpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [axSpanAttributes.DB_TABLE]: req[0].table,
          [axSpanAttributes.DB_NAMESPACE]: req[0].namespace,
          [axSpanAttributes.DB_OPERATION_NAME]: update ? 'update' : 'insert',
        },
      },
      async (span) => {
        try {
          return await this._batchUpsert!(req, update, { span })
        } finally {
          span.end()
        }
      }
    )
  }

  async query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse> {
    if (!this._query) {
      throw new Error('query() not implemented')
    }
    if (!this.tracer) {
      return await this._query(req)
    }

    return await this.tracer.startActiveSpan(
      'DB Query Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [axSpanAttributes.DB_SYSTEM]: this.name,
          [axSpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [axSpanAttributes.DB_TABLE]: req.table,
          [axSpanAttributes.DB_NAMESPACE]: req.namespace,
          [axSpanAttributes.DB_OPERATION_NAME]: 'query',
        },
      },
      async (span) => {
        try {
          return await this._query!(req, { span })
        } finally {
          span.end()
        }
      }
    )
  }
}
