import {
  AxAgent,
  AxAI,
  AxAIOpenAIModel,
  AxMCPClient,
} from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Initialize the MCP client with Blender integration
const blenderTransport = new AxMCPStdioTransport({
  command: 'uvx',
  args: ['blender-mcp'],
});
const client = new AxMCPClient(blenderTransport, { debug: true });
await client.init();

// Create an artistic agent that transforms text prompts into digital art using Blender MCP integration
const drawingAgent = new AxAgent<{ prompt: string }, { imageUrl: string }>({
  name: 'ArtisticBlender',
  description:
    'An AI agent that transforms textual prompts into digital art using Blender MCP integration. Provide a prompt to generate awe-inspiring imagery.',
  signature: 'prompt -> imageUrl',
  functions: [client],
});

// Initialize the AI model with OpenAI GPT-4 Mini
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});
ai.setOptions({ debug: false });

// Run a series of art sessions to generate interesting visuals
async function runArtSession() {
  console.log('\n--- Art Session: Futuristic Cyberpunk Cityscape ---');
  const response1 = await drawingAgent.forward(ai, {
    prompt:
      'Draw a futuristic cyberpunk cityscape with neon lights and rain-soaked streets.',
  });
  console.log(
    'Prompt: Draw a futuristic cyberpunk cityscape with neon lights and rain-soaked streets.'
  );
  console.log(`Generated Art: ${response1.imageUrl}`);

  console.log('\n--- Art Session: Surreal Floating Islands ---');
  const response2 = await drawingAgent.forward(ai, {
    prompt:
      'Imagine and draw a surreal landscape featuring floating islands in a dreamy, colorful sky.',
  });
  console.log(
    'Prompt: Imagine and draw a surreal landscape featuring floating islands in a dreamy, colorful sky.'
  );
  console.log(`Generated Art: ${response2.imageUrl}`);

  console.log('\n--- Art Session: Abstract Cosmic Patterns ---');
  const response3 = await drawingAgent.forward(ai, {
    prompt:
      'Create an abstract illustration of cosmic patterns and vibrant galaxies merging into chaos and order.',
  });
  console.log(
    'Prompt: Create an abstract illustration of cosmic patterns and vibrant galaxies merging into chaos and order.'
  );
  console.log(`Generated Art: ${response3.imageUrl}`);
}

await runArtSession();

// Clean up
await blenderTransport.terminate();
