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
  id: string;
  errors?: string[];
};

// For query

export type DBQueryRequest = {
  id?: string;
  text?: string;
  values?: readonly number[];
  table: string;
  columns: string[];
  limit?: number;
  namespace?: string;
};

export type DBQueryResponse = {
  matches: {
    id: string;
    score: number;
    metadata?: Record<string, string>;
  }[];
};

export interface DB {
  upsert(
    req: Readonly<DBUpsertRequest>,
    update?: boolean
  ): Promise<DBUpsertResponse>;
  batchUpsert(
    batchReq: Readonly<DBUpsertRequest[]>,
    update?: boolean
  ): Promise<DBUpsertResponse[]>;
  query(req: Readonly<DBQueryRequest>): Promise<DBQueryResponse>;
}
