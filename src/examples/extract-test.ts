import { AxAI, AxAIGoogleGeminiModel, AxGen } from '@ax-llm/ax';

// Define the signature with the specific field names
const signature =
  'story:string -> intent:string, dogColors:string[], dogName:string, dogAge:string, dogBreed:string';

// Create the generator
const gen = new AxGen<
  { story: string },
  {
    intent: string;
    dogColors: string[];
    dogName: string;
    dogAge: string;
    dogBreed: string;
  }
>(signature);

// Create AI instance
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini15Flash8B },
});

// Test input
const input = {
  story:
    'Once upon a time, there was a dog named Luki. Luki was a golden retriever. Luki was 2 months old. The colors of his fur are golden, white and brown.',
};

// Run the test with streamingForward
console.log('Testing streamingForward with dog info fields...\n');

const generator = gen.streamingForward(ai, input);

try {
  for await (const res of generator) {
    console.log('Streaming delta:', res);
  }
} catch (error) {
  console.error('Error during streaming:', error);
}

try {
  const result = await gen.forward(ai, input);
  console.log('Result:', result);
} catch (error) {
  console.error('Error during forward:', error);
}
