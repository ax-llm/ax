import { AxAIOpenAIModel, ai, axRAG } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

// Simulated vector database retrieval function
const mockDBFetch = async (query: string): Promise<string> => {
  console.log(`Mocked DB fetch: ${query}`);

  if (!query || query.length === 0) {
    throw new Error('No query provided');
  }

  // Return mock response instead of calling LLM
  return `Mock response for query: "${query}". This simulates retrieving relevant documents from a vector database about machine learning privacy in financial services.`;
};

console.log('=== Advanced RAG Demo with Debug Logging ===');

// Create advanced RAG instance with configuration and debug logging
const rag = axRAG(mockDBFetch, {
  maxHops: 2,
  qualityThreshold: 0.7,
  maxIterations: 2,
  qualityTarget: 0.8,
  disableQualityHealing: false,
  debug: true,
});

const question =
  'How do machine learning algorithms impact privacy in financial services?';

console.log(`\nQuestion: ${question}`);

const result = await rag.forward(llm, {
  originalQuestion: question,
});

console.log(`Answer: ${result.finalAnswer}`);
console.log(`Total hops: ${result.totalHops}`);
console.log(`Iterations: ${result.iterationCount}`);
console.log(`Healing attempts: ${result.healingAttempts}`);
console.log(`Quality achieved: ${result.qualityAchieved}`);
console.log(`Contexts retrieved: ${result.retrievedContexts.length}`);
