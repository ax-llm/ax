import type { Db, MongoClient } from 'mongodb';

export interface HandlerContext {
  db: Db;
  dbClient: MongoClient;
}
