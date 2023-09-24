import * as htmlparser2 from 'htmlparser2';

import { OpenAI } from '../ai/index.js';
import { Weaviate } from '../db/weaviate.js';
import { uuidURL, uuidv5 } from '../util/uuid.js';

import { Spider } from './spider.js';

import 'dotenv/config';

if (!process.env.OPENAI_APIKEY) {
  throw new Error('OPENAI_APIKEY is not set');
}

if (!process.env.WEAVIATE_APIKEY) {
  throw new Error('WEAVIATE_APIKEY is not set');
}

if (!process.env.WEAVIATE_HOST) {
  throw new Error('WEAVIATE_HOST is not set');
}

const chunkSize = 512;
const openAIKey = process.env.OPENAI_APIKEY;
const weaviateKey = process.env.WEAVIATE_APIKEY;
const weaviateHost = process.env.WEAVIATE_HOST;

const spider = new Spider(
  'https://www.pinecone.io/learn/chunking-strategies/',
  async (url, data, nextDepth) => {
    const chunks: string[] = [];

    let textBuff = '';
    let validTag = false;

    const parser = new htmlparser2.Parser(
      {
        onopentag(name, attr) {
          if (name === 'a' && attr.href) {
            spider.queueUrl(attr.href, nextDepth);
          }
          if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) {
            validTag = true;
          } else {
            validTag = false;
          }
        },
        ontext(text) {
          if (!validTag) {
            return;
          }
          const cleanText = text.replace(/^(\n|\t|[^a-zA-Z0-9]+)/g, '').trim();

          if (cleanText.length > 10) {
            textBuff += cleanText;
            while (textBuff.length >= chunkSize) {
              chunks.push(textBuff.slice(0, chunkSize));
              textBuff = textBuff.slice(chunkSize);
            }
          }
        },
        onend() {
          if (textBuff.length > 10) {
            chunks.push(textBuff);
          }
        },
      },
      {
        decodeEntities: true,
      }
    );
    parser.write(data);
    parser.end();

    const ai = new OpenAI(openAIKey);
    const db = new Weaviate(weaviateKey, weaviateHost);
    const batchReq = [];

    let i = 0;
    for (const chunk of chunks) {
      const res = await ai.embed(chunk);
      const id = uuidv5(`${url}#${i}`, uuidURL);

      batchReq.push({
        id,
        table: 'Test',
        values: res.embedding,
        metadata: {
          content: chunk,
        },
      });

      i += 1;
    }

    const res = await db.batchUpsert(batchReq);
    console.log(`${url}\n`, JSON.stringify(res, null, 2));
  },
  {
    depth: 2,
    domains: ['www.pinecone.io'],
  }
);

await spider.crawl();
