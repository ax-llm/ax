import { AxAI, AxAIGoogleGeminiModel } from '@ax-llm/ax';
import { GoogleAuth } from 'google-auth-library';

// Example of using Google Vertex AI with dynamic authentication
// This shows how to use the google-auth-library directly and pass
// a function that gets fresh access tokens as the apiKey parameter

console.log('=== Vertex AI with Dynamic Auth Example ===');

// Create GoogleAuth instance with Vertex AI configuration
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  // You can also specify keyFilename, credentials, projectId etc. here
  // keyFilename: 'path/to/service-account-key.json',
  // projectId: 'your-project-id',
});

// Initialize the auth client and run the example
(async () => {
  // Helper function to refresh the token (call this before using the AI)
  const client = await auth.getClient();

  const apiKey = async () => {
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error('Failed to obtain access token from Google Auth');
    }
    return tokenResponse.token;
  };

  // Create AI instance with function-based API key for Vertex
  const ai = new AxAI({
    name: 'google-gemini',
    apiKey, // Function that returns the cached token
    projectId: process.env.GOOGLE_PROJECT_ID!, // Your Google Cloud Project ID
    region: process.env.GOOGLE_REGION || 'us-central1', // Your preferred region
    config: {
      model: AxAIGoogleGeminiModel.Gemini15Flash,
    },
  });

  // Example usage
  const result = await ai.chat({
    chatPrompt: [
      {
        role: 'user',
        content: 'Hello from Vertex AI with dynamic authentication!',
      },
    ],
  });

  if ('results' in result) {
    console.log('Response:', result.results[0]?.content);
  } else {
    console.log('Streaming response received');
  }
})();
