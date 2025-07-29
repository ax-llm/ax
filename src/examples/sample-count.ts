import { AxAI, AxAIOpenAIModel, ax } from '@ax-llm/ax';

// Create a simple generator for creative writing
export const creativeGen = ax(
  'topic:string "Topic to write about" -> story:string "A creative very short story. 1 line"'
);

console.log('=== Sample Count Demo ===');

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini, stream: true },
  options: { debug: false },
});

console.log('AI service created:', ai.getName());

// Test the new samples() method
console.log('\n=== Multiple Samples (Non-Streaming) ===');
const allSamples = await creativeGen.forward(
  ai,
  {
    topic: 'a robot learning to paint',
  },
  {
    sampleCount: 2,
    modelConfig: {
      temperature: 0.8,
    },
  }
);

console.log('All samples:', allSamples);

// const sampleBuffers: Record<number, string> = {}

// for await (const chunk of streamSamples) {
//     if (!sampleBuffers[chunk.sampleIndex]) {
//         sampleBuffers[chunk.sampleIndex] = ''
//     }

//     if (chunk.delta.story) {
//         sampleBuffers[chunk.sampleIndex] += chunk.delta.story
//         process.stdout.write(`[${chunk.sampleIndex}] ${chunk.delta.story}`)
//     }
// }

// console.log('\n\nFinal samples:')
// for (const [index, content] of Object.entries(sampleBuffers)) {
//     console.log(`Sample ${index}: ${content}`)
// }

// Test backwards compatibility - forward() still returns only the first sample
// console.log('\n=== Backwards Compatibility Test ===')
// const singleResult = await creativeGen.forward(ai, {
//     topic: 'a robot learning to paint',
// }, {
//     sampleCount: 3, // Even with sampleCount, forward() returns only the first
//     modelConfig: {
//         temperature: 0.9,
//     },
// })

// console.log('Single result (backwards compatible):', singleResult)
// console.log('\nSample count demo completed!')
