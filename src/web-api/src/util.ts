import type { KeyObject } from 'crypto';
import type { Db, MongoClient } from 'mongodb';

import type { TaskRunner } from './api/tasks.js';

export interface HandlerContext {
  appSecret: KeyObject;
  dataSecret: KeyObject;
  db: Db;
  dbClient: MongoClient;
  taskRunner: TaskRunner;
}
