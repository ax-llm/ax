// import { AI, OpenAIArgs, TextResponse } from '../index';
// import 'dotenv/config';

// const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

// try {
//   const stream = (await ai.chat(
//     {
//       chatPrompt: [{ role: 'user', content: 'Tell me a joke' }]
//     },
//     { stream: true }
//   )) as ReadableStream<TextResponse>;

//   for await (const v of stream) {
//     const val = v.results[0].content;
//     if (val && val.length > 0) {
//       process.stdout.write(val, 'utf-8');
//     }
//   }
//   console.log('\n');
// } catch (error) {
//   console.error('ERROR:', error);
// }
