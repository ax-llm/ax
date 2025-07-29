// AxFlow async map functionality examples
import { AxAI, AxAIGoogleGeminiModel, AxFlow } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

// Example 1: Single async map - API data enrichment
const enrichmentFlow = new AxFlow<
  { userQuery: string },
  { enrichedData: string; apiCallDuration: number }
>().map(async (state) => {
  console.log('🔄 Making async API call...');
  const startTime = Date.now();

  // Simulate async API call (e.g., fetching data from external service)
  await new Promise((resolve) => setTimeout(resolve, 100));
  const apiData = `Enriched data for: "${state.userQuery}"`;

  const duration = Date.now() - startTime;
  console.log(`✅ API call completed in ${duration}ms`);

  return {
    ...state,
    enrichedData: apiData,
    apiCallDuration: duration,
  };
});

// Example 2: Parallel async maps - Multiple API calls
const multiApiFlow = new AxFlow<
  { productId: string },
  {
    productId: string;
    userReviews: string;
    productDetails: string;
    pricing: string;
  }
>()
  .map(async (state) => {
    console.log('🔄 Fetching user reviews...');
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { ...state, userReviews: `Reviews for product ${state.productId}` };
  })
  .map(async (state) => {
    console.log('🔄 Fetching product details...');
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      ...state,
      productDetails: `Details for product ${state.productId}`,
    };
  })
  .map(async (state) => {
    console.log('🔄 Fetching pricing...');
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { ...state, pricing: `Pricing for product ${state.productId}` };
  });

// Example 3: Mixed sync/async transforms with workflow
const dataProcessingFlow = new AxFlow<
  { rawData: string },
  { processedResult: string; validationStatus: string }
>()
  .node(
    'validator',
    'inputData:string -> isValid:boolean, validationMessage:string'
  )
  // Synchronous preprocessing
  .map((state) => {
    const trimmed = state.rawData?.trim() || '';
    return {
      ...state,
      cleanedData: trimmed.toLowerCase(),
    };
  })
  // Async external validation
  .map(async (state) => {
    console.log('🔄 Performing async validation...');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const isValid = state.cleanedData && state.cleanedData.length > 5;
    return {
      ...state,
      externalValidation: isValid ? 'valid' : 'invalid',
    };
  })
  // Execute AI validation node
  .execute('validator', (state) => ({ inputData: state.cleanedData }))
  // Final async processing
  .map(async (state) => {
    console.log('🔄 Final async processing...');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const aiValid = state.validatorResult.isValid;
    const externalValid = state.externalValidation === 'valid';

    return {
      processedResult: `Processed: ${state.cleanedData}`,
      validationStatus:
        aiValid && externalValid ? 'fully-validated' : 'validation-failed',
    };
  });

// Example 4: Using short alias 'm()' with async functions
const quickAsyncFlow = new AxFlow<
  { message: string },
  { response: string; timestamp: number }
>().m(async (state) => {
  console.log('🔄 Quick async processing with alias...');
  await new Promise((resolve) => setTimeout(resolve, 25));

  return {
    response: `Processed: ${state.message}`,
    timestamp: Date.now(),
  };
});

// Example 5: Complex workflow with multiple async steps
const complexAsyncFlow = new AxFlow<
  { taskList: string[] },
  { completedTasks: string[]; summary: string }
>()
  .node(
    'prioritizer',
    'taskItems:string[] -> prioritizedTasks:string[], reasoning:string'
  )
  // Async preprocessing of task list
  .map(async (state) => {
    console.log('🔄 Async task preprocessing...');
    await new Promise((resolve) => setTimeout(resolve, 40));

    const processedTasks = (state.taskList || []).map(
      (task) => `[preprocessed] ${task}`
    );
    return { ...state, processedTasks };
  })
  // Execute AI prioritizer
  .execute('prioritizer', (state) => ({ taskItems: state.processedTasks }))
  // Process high priority tasks
  .map(async (state) => {
    console.log('🔄 Processing high priority tasks...');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const tasks = (state.prioritizerResult?.prioritizedTasks as string[]) || [];
    const highPriority = tasks.slice(0, 2);
    return { ...state, highPriorityCompleted: highPriority };
  })
  // Process medium priority tasks
  .map(async (state) => {
    console.log('🔄 Processing medium priority tasks...');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const tasks = (state.prioritizerResult?.prioritizedTasks as string[]) || [];
    const mediumPriority = tasks.slice(2, 4);
    return { ...state, mediumPriorityCompleted: mediumPriority };
  })
  // Final async summary generation
  .map(async (state) => {
    console.log('🔄 Generating final summary...');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const completed = [
      ...((state.highPriorityCompleted as string[]) || []),
      ...((state.mediumPriorityCompleted as string[]) || []),
    ];

    return {
      completedTasks: completed,
      summary: `Completed ${completed.length} tasks with reasoning: ${state.prioritizerResult?.reasoning || 'N/A'}`,
    };
  });

console.log('=== Single Async Map - API Data Enrichment ===');
const startTime1 = Date.now();
const result1 = await enrichmentFlow.forward(ai, {
  userQuery: 'latest AI developments',
});
console.log(`⏱️  Total time: ${Date.now() - startTime1}ms`);
console.log('Result:', result1);

console.log('\n=== Parallel Async Maps - Multiple API Calls ===');
const startTime2 = Date.now();
const result2 = await multiApiFlow.forward(ai, {
  productId: 'PROD-123',
});
console.log(
  `⏱️  Total time: ${Date.now() - startTime2}ms (should be ~120ms, not 260ms if run in parallel)`
);
console.log('Result:', result2);

console.log('\n=== Mixed Sync/Async Data Processing Workflow ===');
const result3 = await dataProcessingFlow.forward(ai, {
  rawData: '  Sample Data Input  ',
});
console.log('Result:', result3);

console.log('\n=== Quick Async with Alias ===');
const result4 = await quickAsyncFlow.forward(ai, {
  message: 'Hello async world!',
});
console.log('Result:', result4);

console.log('\n=== Complex Async Workflow ===');
const result5 = await complexAsyncFlow.forward(ai, {
  taskList: ['Task A', 'Task B', 'Task C', 'Task D', 'Task E'],
});
console.log('Result:', result5);

console.log('\n🎉 All async map examples completed successfully!');
