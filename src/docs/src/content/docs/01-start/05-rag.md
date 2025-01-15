---
title: RAG & Vector DBs
description: A guide on working with vector databases and Retrieval Augmented Generation (RAG) in ax.
---

Vector databases are critical to building LLM workflows. We have clean abstractions over popular vector databases and our own quick in-memory vector database.

| Provider   | Tested  |
| ---------- | ------- |
| In Memory  | 🟢 100% |
| Weaviate   | 🟢 100% |
| Cloudflare | 🟡 50%  |
| Pinecone   | 🟡 50%  |

```typescript
// Create embeddings from text using an LLM
const ret = await this.ai.embed({ texts: 'hello world' });

// Create an in memory vector db
const db = new axDB('memory');

// Insert into vector db
await this.db.upsert({
  id: 'abc',
  table: 'products',
  values: ret.embeddings[0]
});

// Query for similar entries using embeddings
const matches = await this.db.query({
  table: 'products',
  values: embeddings[0]
});
```

Alternatively you can use the `AxDBManager` which handles smart chunking, embedding and querying everything
for you, it makes things almost too easy.

```typescript
const manager = new AxDBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query(
  'John von Neumann on human intelligence and singularity.'
);
console.log(matches);
```

### RAG Documents

Using documents like PDF, DOCX, PPT, XLS, etc., with LLMs is a huge pain. We make it easy with Apache Tika, an open-source document processing engine.

Launch Apache Tika

```shell
docker run -p 9998:9998 apache/tika
```

Convert documents to text and embed them for retrieval using the `AxDBManager`, which also supports a reranker and query rewriter. Two default implementations, `AxDefaultResultReranker` and `AxDefaultQueryRewriter`, are available.

```typescript
const tika = new AxApacheTika();
const text = await tika.convert('/path/to/document.pdf');

const manager = new AxDBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query('Find some text');
console.log(matches);
```