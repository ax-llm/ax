import * as htmlparser2 from 'htmlparser2';

import { Spider } from './spider.js';

const spider = new Spider(
  'https://www.pinecone.io/learn/chunking-strategies/',
  (url, data, nextDepth) => {
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
            while (textBuff.length >= 256) {
              chunks.push(textBuff.slice(0, 256));
              textBuff = textBuff.slice(256);
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

    console.log(url);
    chunks.forEach((chunk) => console.log('>', chunk));
  },
  {
    depth: 2,
    domains: ['www.pinecone.io'],
  }
);

await spider.crawl();
