import { AI } from '../ai/index.js';
import { Prompt, PromptUpdaterArgs } from '../ai/middleware.js';
import { Pinecone } from '../db/pinecone.js';
import { DBService } from '../db/types.js';
import { Weaviate } from '../db/weaviate.js';

import { ExtendedIncomingMessage } from './types.js';

const defaultQueryRewritePrompt = `Transform the following text line into an optimized query for embedding and leveraging with a vector database for an efficient similarity search`;

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
    const rewriteQuery = req.headers['x-llmclient-db-rewrite-query'] as
      | string
      | undefined;
    const rewriteQueryPrompt = req.headers[
      'x-llmclient-db-rewrite-query-prompt'
    ] as string | undefined;

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

    let dbQuery = prompt;

    const ai = AI(req.providerName, req.middleware.getAPIKey(), {});

    if (rewriteQuery && rewriteQuery.toLowerCase() === 'true') {
      const rqPrompt =
        !rewriteQueryPrompt || rewriteQueryPrompt === ''
          ? `${defaultQueryRewritePrompt}: ${prompt}\nQuery:`
          : `${rewriteQueryPrompt}: ${prompt}\nQuery:`;

      const { results } = await ai.generate(rqPrompt, {
        traceId: req.traceId,
        sessionId: req.sessionId,
        stopSequences: ['\n'],
      });
      const newPrompt = results.at(0)?.text;

      if (newPrompt && newPrompt !== '') {
        dbQuery = newPrompt;
      }
    }

    const { embedding } = await ai.embed(dbQuery, {
      traceId: req.traceId,
      sessionId: req.sessionId,
    });

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
      console.log('- vector db query:', prompt);
      console.log('- vector db rewritten-query:', dbQuery);
      console.log('- vector db result:', result);
    }

    return [{ role: 'system', text: result ?? '' }];
  };
}
