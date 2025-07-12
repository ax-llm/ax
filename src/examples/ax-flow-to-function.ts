import { AxAI } from '@ax-llm/ax';
import { AxFlow } from '../ax/flow/flow.js';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY || '',
});

console.log('=== AxFlow Function Conversion Examples ===\n');

// Example 1: Direct signature execution (no nodes)
console.log('1. Direct signature execution (no nodes):');
const directFlow = new AxFlow('userQuestion:string -> answerText:string');

const directResult = await directFlow.forward(ai, {
  userQuestion: 'What is the capital of France?',
});

console.log('Direct flow result:', directResult);
console.log();

// Example 2: Regular flow with nodes (existing test)
console.log('2. Regular flow with nodes:');
const flow = new AxFlow('inputText:string -> outputText:string')
  .node('processor', 'textContent:string -> processedText:string')
  .execute('processor', (state) => ({ textContent: state.inputText }))
  .map((state) => ({ outputText: state.processorResult.processedText }));

const result = await flow.forward(ai, { inputText: 'Hello world' });
console.log('Flow with nodes result:', result);
console.log();

// Example 3: Named flow with function conversion capability
console.log('3. Named flow with function conversion:');
const namedFlow = new AxFlow({
  name: 'Question Answerer',
  description: 'Answers user questions in a helpful and informative way',
  signature: 'userQuestion:string -> responseText:string',
});

// Test function conversion
try {
  const flowAsFunction = namedFlow.toFunction();
  console.log('Function conversion successful:');
  console.log('- Name:', flowAsFunction.name);
  console.log('- Description:', flowAsFunction.description);
  console.log(
    '- Parameters schema keys:',
    Object.keys(flowAsFunction.parameters?.properties || {})
  );
} catch (error) {
  console.error('Function conversion failed:', error);
}

// Test direct execution of named flow
const namedResult = await namedFlow.forward(ai, {
  userQuestion: 'Explain quantum computing in simple terms.',
});

console.log('Named flow result:', namedResult);
console.log();

// Example 4: Input validation tests
console.log('4. Input validation tests:');

// Test missing required field
try {
  await flow.forward(ai, {} as any);
  console.log('ERROR: Should have thrown for missing field');
} catch (error) {
  console.log('✓ Correctly caught missing field:', (error as Error).message);
}

// Test unexpected field
try {
  await flow.forward(ai, { inputText: 'test', unexpected: 'field' } as any);
  console.log('ERROR: Should have thrown for unexpected field');
} catch (error) {
  console.log('✓ Correctly caught unexpected field:', (error as Error).message);
}

console.log('\n=== All tests completed successfully ===');
