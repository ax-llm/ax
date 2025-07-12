import { AxAI } from '@ax-llm/ax';

// Initialize the AI service with your API key
const ai = new AxAI({
  name: 'openai', // You can use 'anthropic', 'google-gemini', etc.
  apiKey: process.env.OPENAI_APIKEY as string,
});

try {
  console.log('Generating embeddings for example text...');

  // Simple example: embedding a single string
  const result = await ai.embed({
    texts: ['This is a sample text to embed.'],
  });

  console.log('\nEmbedding results:');
  console.log(`- Number of embeddings: ${result.embeddings.length}`);

  // Check if we have a valid embedding
  if (result.embeddings.length > 0 && result.embeddings[0]) {
    const embedding = result.embeddings[0];
    console.log(`- Embedding dimensions: ${embedding.length}`);
    console.log(`- First few values: [${embedding.slice(0, 3).join(', ')}...]`);
  }

  // Display model usage information if available
  if (result.modelUsage) {
    console.log('\nModel usage information:');
    console.log(`- AI provider: ${result.modelUsage.ai}`);
    console.log(`- Model used: ${result.modelUsage.model}`);

    if (result.modelUsage.tokens) {
      console.log(`- Tokens used: ${JSON.stringify(result.modelUsage.tokens)}`);
    }
  }

  console.log('\nEmbeddings can be used for:');
  console.log('- Semantic search');
  console.log('- Document similarity comparison');
  console.log('- Clustering related content');
  console.log('- Building knowledge retrieval systems');
} catch (error) {
  console.error('Error generating embeddings:', error);
}
