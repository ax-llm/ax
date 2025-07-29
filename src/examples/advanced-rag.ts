import { AxAIGoogleGeminiModel, ai, ax, axRAG, } from '@ax-llm/ax'

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

// Simulated vector database retrieval function using AxGen
const fetchFromVectorDB = async (query: string) => {
  // In a real implementation, this would query your vector database
  // For demo purposes, we'll simulate retrieval with AxGen
  const contextRetriever = ax(
    `searchQuery:string "Query to search for relevant information" -> 
    sourceType:class "class1, class2, class3",
    relevantContext "Detailed factual information relevant to the query",
    sources:string "Source references for the information"
  `
  );

  const result = await contextRetriever.forward(llm, {
    searchQuery: query,
  });

  console.log(result.sourceType);
  return result.relevantContext;
};

// Create RAG flow with all features
const advancedRAG = axRAG(fetchFromVectorDB, {
  maxHops: 2,
  qualityThreshold: 0.7,
  maxIterations: 1,
  qualityTarget: 0.8,
  disableQualityHealing: false,
});

const advancedResult = await advancedRAG.forward(ai, {
  originalQuestion:
    'How do machine learning algorithms impact privacy in financial services?',
});

console.log('Advanced RAG Result:');
console.log('Final Answer:', advancedResult.finalAnswer);
console.log('Total Hops:', advancedResult.totalHops);
console.log('Iteration Count:', advancedResult.iterationCount);
console.log('Healing Attempts:', advancedResult.healingAttempts);
console.log('Quality Achieved:', advancedResult.qualityAchieved);

console.log('\n=== Fast RAG (Quality Healing Disabled) ===');

// Create fast RAG flow with quality healing disabled
const fastRAG = axRAG(fetchFromVectorDB, {
  maxHops: 1,
  maxIterations: 1,
  disableQualityHealing: true,
});

const fastResult = await fastRAG.forward(ai, {
  originalQuestion: 'What is the impact of solar energy on the environment?',
});

console.log('Fast RAG Result:');
console.log('Final Answer:', fastResult.finalAnswer);
console.log('Total Hops:', fastResult.totalHops);
console.log('Quality Achieved:', fastResult.qualityAchieved);
console.log('Healing Attempts:', fastResult.healingAttempts);
function _axAI_arg00: { name: string; apiKey: string; config: { model: AxAIGoogleGeminiModel; }; }) {
  throw new Error('Function not implemented.');
}

