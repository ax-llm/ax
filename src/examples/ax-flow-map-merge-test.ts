import { AxAI, AxFlow } from '@ax-llm/ax';

// Test signature inference with map and merge as final operations
console.log('=== Testing Map and Merge Final Operations ===');

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Test 1: Flow ending with map operation
console.log('\n1. Flow ending with MAP operation:');
const flowWithMap = new AxFlow()
  .node('processor', 'inputText:string -> processedData:string')
  .execute('processor', (state: any) => ({ inputText: state.userInput }))
  .map((state: any) => ({
    finalResult: `Processed: ${state.processorResult.processedData}`,
    timestamp: new Date().toISOString(),
  }));

console.log('Before execution:', flowWithMap.getSignature().toString());

try {
  const result1 = await flowWithMap.forward(ai, { userInput: 'test input' });
  console.log('After execution:', flowWithMap.getSignature().toString());
  console.log('Result:', result1);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : String(error));
}

// Test 2: Flow ending with conditional merge
console.log('\n2. Flow ending with CONDITIONAL MERGE:');
const flowWithMerge = new AxFlow({ autoParallel: false })
  .node('analyzer', 'inputText:string -> isComplex:boolean')
  .node('simpleProcessor', 'inputText:string -> processedText:string')
  .node('complexProcessor', 'inputText:string -> processedText:string')
  .execute('analyzer', (state: any) => ({ inputText: state.userInput }))
  .branch((state: any) => state.analyzerResult.isComplex)
  .when(true)
  .execute('complexProcessor', (state: any) => ({ inputText: state.userInput }))
  .when(false)
  .execute('simpleProcessor', (state: any) => ({ inputText: state.userInput }))
  .merge();

console.log('Before execution:', flowWithMerge.getSignature().toString());

try {
  const result2 = await flowWithMerge.forward(ai, {
    userInput: 'complex analysis needed',
  });
  console.log('After execution:', flowWithMerge.getSignature().toString());
  console.log('Result:', result2);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : String(error));
}

// Test 3: Flow ending with parallel merge
console.log('\n3. Flow ending with PARALLEL MERGE:');
const flowWithParallelMerge = new AxFlow({ autoParallel: false })
  .node('processor1', 'inputText:string -> processedText1:string')
  .node('processor2', 'inputText:string -> processedText2:string')
  .parallel([
    (subFlow: any) =>
      subFlow.execute('processor1', (state: any) => ({
        inputText: state.userInput,
      })),
    (subFlow: any) =>
      subFlow.execute('processor2', (state: any) => ({
        inputText: state.userInput,
      })),
  ])
  .merge('combinedResults', (result1: any, result2: any) => ({
    combined: [
      result1.processor1Result?.processedText1,
      result2.processor2Result?.processedText2,
    ],
  }));

console.log(
  'Before execution:',
  flowWithParallelMerge.getSignature().toString()
);

try {
  const result3 = await flowWithParallelMerge.forward(ai, {
    userInput: 'parallel processing',
  });
  console.log(
    'After execution:',
    flowWithParallelMerge.getSignature().toString()
  );
  console.log('Result:', result3);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : String(error));
}
