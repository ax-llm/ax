// For upsert

export type DBUpsertRequest = {
  id: string;
  text?: string;
  values?: readonly number[];
  metadata?: Record<string, string>;
  table: string;
  namespace?: string;
};

export type DBUpsertResponse = {
  ids: string[];
};

// For query
export type DBQueryRequest = {
  id?: string;
  text?: string;
  values?: readonly number[];
  table: string;
  columns?: string[];
  limit?: number;
  namespace?: string;
};

export type DBQueryResponse = {
  matches: {
    id: string;
    score: number;
    metadata?: Record<string, string>;
    table?: string;
  }[];
};

export interface DBService extends DBQueryService {
  upsert(
    req: Readonly<DBUpsertRequest>,
    update?: boolean
  ): Promise<DBUpsertResponse>;

  batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse>;
}

export interface DBQueryService {
  query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse>;
}
