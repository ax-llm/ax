import { Prompt, PromptUpdaterArgs } from '../ai/middleware.js';
import { Pinecone } from '../db/pinecone.js';
import { DBService } from '../db/types.js';
import { Weaviate } from '../db/weaviate.js';

import { ExtendedIncomingMessage } from './types.js';

export class VectorMemoryStore {
  private readonly debug: boolean;

  constructor(debug: boolean) {
    this.debug = debug;
  }

  getMemory = async (
    req: Readonly<ExtendedIncomingMessage>,
    { prompt }: Readonly<PromptUpdaterArgs>
  ): Promise<Prompt[] | undefined> => {
    const host = req.headers['x-llmclient-db-host'] as string | undefined;
    const apiKey = req.headers['x-llmclient-db-apikey'] as string | undefined;
    const values = req.headers['x-llmclient-db-values'] as string | undefined;
    const table = req.headers['x-llmclient-db-table'] as string | undefined;
    const namespace = req.headers['x-llmclient-db-namespace'] as
      | string
      | undefined;

    if (!prompt || prompt.length === 0) {
      return;
    }

    if (!host || !apiKey || !values || !table) {
      return;
    }

    let db: DBService;

    if (host.indexOf('pinecone') > -1) {
      db = new Pinecone(apiKey, host);
    } else if (host.indexOf('weaviate') > -1) {
      db = new Weaviate(apiKey, host);
    } else {
      throw new Error('Unknown DB host');
    }

    const embedding = await req.middleware.embed(prompt);

    const res = await db.query({
      namespace,
      table,
      values: embedding,
      columns: values.split(','),
    });

    const result = res.matches
      ?.map(({ metadata }) => Object.entries(metadata ?? {})?.map(([, v]) => v))
      .join('\n');

    if (this.debug) {
      console.log('>', result);
    }

    return [{ role: 'system', text: result ?? '' }];
  };
}
