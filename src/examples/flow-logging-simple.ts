import {
  AxMockAIService,
  axCreateFlowColorLogger,
  flow as createFlow,
} from '@ax-llm/ax';

// Create a simple flow with verbose logging enabled
const logger = axCreateFlowColorLogger();

const flow = createFlow<{ userInput: string }, { finalOutput: string }>({
  logger: logger,
})
  .map((state) => ({
    processedInput: `Processed: ${state.userInput}`,
    timestamp: new Date().toISOString(),
  }))
  .map((state) => ({
    finalOutput: `${state.processedInput} at ${state.timestamp}`,
  }));

// Test the flow with verbose logging (no AI needed for this simple test)
console.log('🚀 Testing AxFlow verbose logging...\n');

try {
  // Create a mock AI service
  const ai = new AxMockAIService<string>({
    chatResponse: {
      results: [
        {
          index: 0,
          content: 'Mock response',
        },
      ],
      modelUsage: {
        ai: 'mock',
        model: 'mock-model',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    },
  });

  const result = await flow.forward(ai, {
    userInput: 'Hello, AxFlow!',
  });

  console.log('\n✅ Flow completed successfully!');
  console.log('Final result:', result);
} catch (error) {
  console.error('\n❌ Flow failed:', error);
}
