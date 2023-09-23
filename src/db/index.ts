// import { v5 as uuid } from 'uuid';

import { Weaviate } from './weaviate.js';

const db = new Weaviate(
  'OVho1O5rN0gJhCfHPrUhKpz2ChYfHAgpGfUI',
  'https://daos-e4gd53ta.weaviate.network'
);

// const content = `The namespace data is itself a UUID, and the name data could really be any arbitrary string, although in practice it typically relates to how the UUID will be used – it might be an account name, for example, or a product ID. But whatever the two values used are, they’re hashed to generate a 36-character alphanumeric string that is the final UUID.`;

// const id = uuid('http://test.com/2', uuid.URL);

// console.log('>', id);

// const res = await db.upsert({
//   id: id,
//   table: 'Test',
//   //   namespace: 'test',
//   values: [1, 2, 3],
//   metadata: {
//     content,
//   },
// });

const res = await db.query({
  //   namespace: 'test',
  table: 'Test',
  values: [1, 2, 3],
  columns: ['content'],
});

console.log('>>', JSON.stringify(res, null, 2));
