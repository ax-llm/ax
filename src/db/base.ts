import {
  type Span,
  SpanAttributes,
  SpanKind,
  type Tracer
} from '../trace/index.js';

import type {
  DBQueryRequest,
  DBQueryResponse,
  DBService,
  DBUpsertRequest,
  DBUpsertResponse
} from './types.js';

export interface BaseArgs {
  fetch?: typeof fetch;
  tracer?: Tracer;
}

export interface BaseOpOptions {
  span?: Span;
}

export class BaseDB implements DBService {
  protected name: string;
  protected fetch?: typeof fetch;
  private tracer?: Tracer;

  _upsert?: (
    req: Readonly<DBUpsertRequest>,
    update?: boolean,
    options?: Readonly<BaseOpOptions>
  ) => Promise<DBUpsertResponse>;

  _batchUpsert?: (
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean,
    options?: Readonly<BaseOpOptions>
  ) => Promise<DBUpsertResponse>;

  _query?: (
    req: Readonly<DBQueryRequest>,
    options?: Readonly<BaseOpOptions>
  ) => Promise<DBQueryResponse>;

  constructor({ name, fetch, tracer }: Readonly<BaseArgs & { name: string }>) {
    this.name = name;
    this.fetch = fetch;
    this.tracer = tracer;
  }

  async upsert(
    req: Readonly<DBUpsertRequest>,
    update?: boolean
  ): Promise<DBUpsertResponse> {
    if (!this._upsert) {
      throw new Error('upsert() not implemented');
    }
    const _upsert = this._upsert;

    if (!this.tracer) {
      return await _upsert(req, update);
    }

    return await this.tracer?.startActiveSpan(
      'DB Upsert Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [SpanAttributes.DB_SYSTEM]: this.name,
          [SpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [SpanAttributes.DB_TABLE]: req.table,
          [SpanAttributes.DB_NAMESPACE]: req.namespace,
          [SpanAttributes.DB_OPERATION_NAME]: update ? 'update' : 'insert'
        }
      },
      async (span) => {
        const res = await _upsert(req, update, { span });
        span.end();
        return res;
      }
    );
  }

  async batchUpsert(
    req: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse> {
    if (!this._batchUpsert) {
      throw new Error('batchUpsert() not implemented');
    }
    if (req.length == 0) {
      throw new Error('Batch request is empty');
    }
    if (!req[0]) {
      throw new Error('Batch request is invalid first element is undefined');
    }

    const _batchUpsert = this._batchUpsert;

    if (!this.tracer) {
      return await _batchUpsert(req, update);
    }

    return await this.tracer?.startActiveSpan(
      'DB Batch Upsert Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [SpanAttributes.DB_SYSTEM]: this.name,
          [SpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [SpanAttributes.DB_TABLE]: req[0].table,
          [SpanAttributes.DB_NAMESPACE]: req[0].namespace,
          [SpanAttributes.DB_OPERATION_NAME]: update ? 'update' : 'insert'
        }
      },
      async (span) => {
        const res = await _batchUpsert(req, update, { span });
        span.end();
        return res;
      }
    );
  }

  async query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse> {
    if (!this._query) {
      throw new Error('query() not implemented');
    }
    const _query = this._query;

    if (!this.tracer) {
      return await _query(req);
    }

    return await this.tracer?.startActiveSpan(
      'DB Query Request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          [SpanAttributes.DB_SYSTEM]: this.name,
          [SpanAttributes.DB_OPERATION_NAME]: 'upsert',
          [SpanAttributes.DB_TABLE]: req.table,
          [SpanAttributes.DB_NAMESPACE]: req.namespace,
          [SpanAttributes.DB_OPERATION_NAME]: 'query'
        }
      },
      async (span) => {
        const res = await _query(req, { span });
        span.end();
        return res;
      }
    );
  }
}
