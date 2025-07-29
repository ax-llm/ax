import { AxAIOpenAIModel, ai, axRAG } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

// Simulated vector database retrieval function
const fetchFromVectorDB = async (query: string): Promise<string> => {
  // In a real implementation, this would query your vector database
  // For demo purposes, we'll return mock contextual data based on query
  if (!query || typeof query !== 'string') {
    return 'General information about renewable energy, sustainability, and environmental technology.';
  }

  const mockData: Record<string, string> = {
    'renewable energy':
      'Renewable energy sources like solar, wind, and hydro power provide clean electricity without fossil fuel emissions. Benefits include reduced carbon footprint, energy independence, and long-term cost savings.',
    'machine learning privacy':
      'Machine learning in financial services raises privacy concerns through data collection, algorithmic bias, and potential for discrimination. Regulations like GDPR require explicit consent and data protection measures.',
    'solar energy environment':
      'Solar energy has minimal environmental impact during operation, producing no emissions. Manufacturing solar panels requires energy and materials, but lifecycle analysis shows net positive environmental benefits.',
  };

  // Simple matching logic for demo
  const queryLower = query.toLowerCase();
  const matchedKey = Object.keys(mockData).find(
    (key) => queryLower.includes(key) || key.includes(queryLower)
  );

  return matchedKey
    ? mockData[matchedKey]
    : 'General information about renewable energy, sustainability, and environmental technology.';
};

console.log('=== Advanced RAG Demo with Debug Logging ===');

// Create advanced RAG instance with configuration and debug logging
const advancedRAG = axRAG(fetchFromVectorDB, {
  maxHops: 2,
  qualityThreshold: 0.7,
  maxIterations: 2,
  qualityTarget: 0.8,
  disableQualityHealing: false,
  debug: true,
});

const questions = [
  'What are the benefits of renewable energy?',
  'How do machine learning algorithms impact privacy in financial services?',
  'What is the impact of solar energy on the environment?',
];

for (const question of questions) {
  console.log(`\nQuestion: ${question}`);

  const result = await advancedRAG.forward(llm, {
    originalQuestion: question,
  });

  console.log(`Answer: ${result.finalAnswer}`);
  console.log(`Total hops: ${result.totalHops}`);
  console.log(`Iterations: ${result.iterationCount}`);
  console.log(`Healing attempts: ${result.healingAttempts}`);
  console.log(`Quality achieved: ${result.qualityAchieved}`);
  console.log(`Contexts retrieved: ${result.retrievedContexts.length}`);
}
