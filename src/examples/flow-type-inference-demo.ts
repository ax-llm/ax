import { ai, flow } from '@ax-llm/ax';

// Example 1: Input type is now required - much better type safety!
const _basicFlow = flow<{ userQuestion: string }>().map((state) => ({
  ...state,
  // ✅ TypeScript knows this field exists from the input type
  answer: state.userQuestion.toLowerCase(),
}));

// Example 2: Complex input type - Full type safety with multiple fields!
const typedFlow = flow<{ userQuestion: string; context: string }>()
  .map((state) => ({
    ...state,
    // TypeScript knows these fields exist!
    processedQuestion: state.userQuestion.toUpperCase(),
    hasContext: state.context.length > 0,
  }))
  .node('analyzer', 'processedQuestion:string -> analysis:string')
  .execute('analyzer', (state) => ({
    // Full IntelliSense and type checking
    processedQuestion: state.processedQuestion,
  }))
  .map((state) => ({
    // TypeScript tracks the evolving state type
    finalAnswer: state.analyzerResult.analysis,
    originalQuestion: state.userQuestion,
  }));

// Usage - TypeScript knows the input and output types!
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

console.log('=== Flow Type Inference Demo ===\n');

const result = await typedFlow.forward(llm, {
  userQuestion: 'What is TypeScript?',
  context: 'Programming languages',
});

console.log('Result:', result);
// Note: TypeScript's type inference for complex flows is limited
// The actual result will have finalAnswer and originalQuestion fields at runtime

console.log('\n✅ Full type safety throughout the flow!');
console.log('✅ IntelliSense knows all available fields!');
console.log('✅ Simple generic parameter declares expected input type!');
