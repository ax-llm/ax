import { AI } from '../ai/index.js';
import { DB, DBService } from '../db/index.js';
import { AIService } from '../text/types.js';
import { uuidURL, uuidv5 } from '../util/uuid.js';

type RequestHandler = (
  queueUrl: (url: string, nextDepth: number) => void,
  data: string,
  depth: number
) => string[];

type CrawlerConfig = {
  llmAPIKey: string;
  llmType: string;
  llmOptions: Record<string, string>;
  dbAPIKey: string;
  dbHost: string;
  dbTable: string;
  dbNamespace?: string;
  dbOptions: Record<string, string>;
  startPage: string;
  handleRequest: RequestHandler;
  config: Readonly<{ depth: number; domains: string[] }>;
};

export class Crawler {
  private ai: AIService;
  private db: DBService;
  private handleRequest: RequestHandler;
  private startPage: string;
  private dbTable: string;
  private dbNamespace?: string;

  concurrent = 5;
  delay = 0; // in ms
  depth: number;
  domains: string[];
  queue: { url: string; depth: number }[] = [];
  visited: { [url: string]: boolean } = {};
  defaultDomain: string;

  constructor({
    llmAPIKey,
    llmType,
    llmOptions,
    dbAPIKey,
    dbHost,
    dbTable,
    dbNamespace,
    dbOptions,
    startPage,
    handleRequest,
    config
  }: Readonly<CrawlerConfig>) {
    this.ai = AI(llmType, llmAPIKey, llmOptions);
    this.db = DB(dbHost, dbAPIKey, dbOptions);
    this.dbTable = dbTable;
    this.dbNamespace = dbNamespace;

    this.startPage = startPage;
    this.handleRequest = handleRequest;

    this.depth = config.depth;
    this.defaultDomain = new URL(startPage).hostname;
    this.domains = [this.defaultDomain, ...config.domains];
    this.queue.push({ url: startPage, depth: 1 });
  }

  async crawl() {
    while (this.queue.length > 0) {
      const value = this.queue.shift();
      if (!value) {
        break;
      }
      // eslint-disable-next-line prefer-const
      let { url, depth } = value;
      let parsedUrl;

      if (url.indexOf('://') === -1) {
        parsedUrl = new URL(url, this.startPage);
        url = parsedUrl.href;
      } else {
        parsedUrl = new URL(url);
      }

      if (depth > this.depth) {
        continue;
      }

      if (this.domains.indexOf(parsedUrl.hostname) == -1) {
        continue;
      }

      if (!this.visited[url]) {
        this.visited[url] = true;
        try {
          const res = await fetch(url);
          const data = await res.text();

          if (
            res.status !== 200 ||
            res.headers.get('content-type') !== 'text/html'
          ) {
            continue;
          }
          const chunks = this.handleRequest(this.queueUrl, data, depth + 1);
          await this.vectorizeChunks(url, chunks);
        } catch (e) {
          console.error(e);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }

  queueUrl(url: string, depth: number) {
    this.queue.push({ url, depth });
  }

  private async vectorizeChunks(url: string, chunks: readonly string[]) {
    const batchReq = [];

    let i = 0;
    for (const chunk of chunks) {
      const res = await this.ai.embed({ texts: [chunk] });
      const id = uuidv5(`${url}#${i}`, uuidURL);

      batchReq.push({
        id,
        table: this.dbTable,
        namespace: this.dbNamespace,
        values: res.embeddings.at(0),
        metadata: {
          content: chunk
        }
      });
      i += 1;
    }
    await this.db.batchUpsert(batchReq);
  }
}
