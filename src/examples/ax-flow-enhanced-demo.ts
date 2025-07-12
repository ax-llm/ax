import { AxAI } from '@ax-llm/ax';
import { AxProgram } from '../ax/dsp/program.js';
import { AxFlow } from '../ax/flow/flow.js';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY || '',
});

console.log('=== Enhanced AxFlow Demo ===\n');

// Example of a custom program that can fail occasionally
export class ReliableProcessor extends AxProgram<
  { inputText: string },
  { processedOutput: string }
> {
  constructor() {
    super('inputText:string -> processedOutput:string');
  }

  override async forward(
    _ai: any,
    values: { inputText: string }
  ): Promise<{ processedOutput: string }> {
    // Simulate processing
    return {
      processedOutput: `Processed: ${values.inputText}`,
    };
  }
}

// Example 1: Instance-Based Node Definition (replaces class support)
console.log('1. Instance-Based Node Definition:');

const processor1 = new ReliableProcessor();
const processor2 = new ReliableProcessor();

const instanceFlow = new AxFlow('userInput:string -> finalOutput:string')
  .node('primary', processor1) // Pass instance, not class
  .node('secondary', processor2) // Pass instance, not class
  .execute('primary', (state) => ({ inputText: state.userInput }))
  .execute('secondary', (state) => ({
    inputText: state.primaryResult.processedOutput,
  }))
  .map((state) => ({
    finalOutput: `Final: ${state.secondaryResult.processedOutput}`,
  }));

const result1 = await instanceFlow.forward(ai, {
  userInput: 'Hello, enhanced AxFlow!',
});

console.log('Instance-based result:', result1.finalOutput);
console.log();

// Example 2: Error Handling Configuration
console.log('2. Error Handling Configuration:');

const errorHandlingFlow = new AxFlow(
  'userQuery:string -> queryResponse:string',
  {
    errorHandling: {
      defaultRetries: 2,
      retryDelay: 1000,
      exponentialBackoff: true,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 3,
        resetTimeout: 5000,
      },
    },
  }
)
  .node('processor', 'queryText:string -> responseText:string')
  .execute('processor', (state) => ({ queryText: state.userQuery }))
  .map((state) => ({ queryResponse: state.processorResult.responseText }));

const result2 = await errorHandlingFlow.forward(ai, {
  userQuery: 'Process this query with error handling.',
});

console.log('Error handling result:', result2.queryResponse);
console.log();

// Example 3: Performance Optimization Configuration
console.log('3. Performance Optimization Configuration:');

const performanceFlow = new AxFlow('inputData:string -> outputData:string', {
  autoParallel: true,
  errorHandling: {
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2,
      resetTimeout: 3000,
    },
  },
})
  .node('analyzer', 'dataInput:string -> analysis:string')
  .node('formatter', 'analysisData:string -> formattedOutput:string')
  .execute('analyzer', (state) => ({ dataInput: state.inputData }))
  .execute('formatter', (state) => ({
    analysisData: state.analyzerResult.analysis,
  }))
  .map((state) => ({ outputData: state.formatterResult.formattedOutput }));

const result3 = await performanceFlow.forward(ai, {
  inputData: 'Data to process with performance optimizations.',
});

console.log('Performance optimized result:', result3.outputData);
console.log();

// Example 3.5: Concurrency Control with Batching
console.log('3.5. Concurrency Control with Batching:');

const concurrencyFlow = new AxFlow('batchInput:string -> batchOutput:string', {
  autoParallel: true,
  maxConcurrency: 2, // Only 2 operations run simultaneously
})
  .node('worker1', 'workData:string -> workResult:string')
  .node('worker2', 'workData:string -> workResult:string')
  .node('worker3', 'workData:string -> workResult:string')
  .node('worker4', 'workData:string -> workResult:string')
  .parallel([
    // These 4 operations will be batched with maxConcurrency=2
    // So: worker1+worker2 run first, then worker3+worker4 run
    (subFlow: any) =>
      subFlow.execute('worker1', (state: any) => ({
        workData: `${state.batchInput}-1`,
      })),
    (subFlow: any) =>
      subFlow.execute('worker2', (state: any) => ({
        workData: `${state.batchInput}-2`,
      })),
    (subFlow: any) =>
      subFlow.execute('worker3', (state: any) => ({
        workData: `${state.batchInput}-3`,
      })),
    (subFlow: any) =>
      subFlow.execute('worker4', (state: any) => ({
        workData: `${state.batchInput}-4`,
      })),
  ])
  .merge('batchOutput', (r1: any, r2: any, r3: any, r4: any) => {
    return `Batched: ${r1.workResult}, ${r2.workResult}, ${r3.workResult}, ${r4.workResult}`;
  });

const startTime = Date.now();
const resultConcurrency = await concurrencyFlow.forward(ai, {
  batchInput: 'Batch job',
});
const duration = Date.now() - startTime;

console.log('Concurrency result:', resultConcurrency.batchOutput);
console.log(
  `Execution time: ${duration}ms (with batching to max 2 concurrent)`
);
console.log();

// Example 4: Enhanced Type Safety with Explicit Merge Types
console.log('4. Enhanced Type Safety with Explicit Merge Types:');

const typeSafeFlow = new AxFlow('inputValue:string -> outputValue:string')
  .node('classifier', 'inputValue:string -> categoryType:string')
  .node('simpleHandler', 'inputValue:string -> processedValue:string')
  .node('complexHandler', 'inputValue:string -> processedValue:string')
  .execute('classifier', (state) => ({ inputValue: state.inputValue }))
  .branch((state) => state.classifierResult.categoryType)
  .when('simple')
  .execute('simpleHandler', (state) => ({ inputValue: state.inputValue }))
  .map((state) => ({
    result: state.simpleHandlerResult.processedValue,
    method: 'simple' as const,
  }))
  .when('complex')
  .execute('complexHandler', (state) => ({ inputValue: state.inputValue }))
  .map((state) => ({
    result: state.complexHandlerResult.processedValue,
    method: 'complex' as const,
  }))
  // Use explicit merge type for better type safety
  .merge<{ result: string; method: 'simple' | 'complex' }>()
  .map((state) => ({
    outputValue: `${state.method}: ${state.result}`,
  }));

const result4 = await typeSafeFlow.forward(ai, {
  inputValue: 'Test data for type-safe processing.',
});

console.log('Type-safe result:', result4.outputValue);
console.log();

// Example 5: Execution Plan Analysis
console.log('5. Execution Plan Analysis:');

const complexFlow = new AxFlow('inputText:string -> finalOutput:string')
  .node('tokenizer', 'inputText:string -> tokenCount:number')
  .node('processor1', 'tokens:number -> processedResult1:string')
  .node('processor2', 'tokens:number -> processedResult2:string')
  .node(
    'combiner',
    'processedResult1:string, processedResult2:string -> combinedResult:string'
  )
  .execute('tokenizer', (state) => ({ inputText: state.inputText }))
  .execute('processor1', (state) => ({
    tokens: state.tokenizerResult.tokenCount,
  }))
  .execute('processor2', (state) => ({
    tokens: state.tokenizerResult.tokenCount,
  }))
  .execute('combiner', (state) => ({
    processedResult1: state.processor1Result.processedResult1,
    processedResult2: state.processor2Result.processedResult2,
  }))
  .map((state) => ({ finalOutput: state.combinerResult.combinedResult }));

const executionPlan = complexFlow.getExecutionPlan();
console.log('Execution Plan Details:');
console.log('- Total Steps:', executionPlan.totalSteps);
console.log('- Parallel Groups:', executionPlan.parallelGroups);
console.log('- Max Parallelism:', executionPlan.maxParallelism);
console.log('- Auto-Parallel Enabled:', executionPlan.autoParallelEnabled);

console.log('\n=== Enhanced AxFlow features demonstrated ===');
