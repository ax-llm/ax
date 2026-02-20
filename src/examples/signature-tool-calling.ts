import { AxAIOpenAIModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

// Example tools with dot notation support
const searchTool = {
  name: 'searchWeb',
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Maximum results' },
    },
    required: ['query'],
  },
  func: async (args: { query: string; limit?: number }) => {
    console.log(`Searching for: ${args.query}`);
    return `Found results for "${args.query}"`;
  },
};

const calculateTool = {
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Mathematical expression' },
    },
    required: ['expression'],
  },
  func: async (args: { expression: string }) => {
    console.log(`Calculating: ${args.expression}`);
    // biome-ignore lint/security/noGlobalEval: Safe for demo purposes
    return `Result: ${eval(args.expression)}`;
  },
};

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { stream: false, model: AxAIOpenAIModel.GPT4OMini },
});

// Create agent with function call mode set to prompt
const smartAgent = agent(
  'question:string -> answer:string "You are a helpful assistant that can search the web and perform calculations. Use the available tools when needed."',
  {
    functions: [searchTool, calculateTool],
    functionCallMode: 'prompt', // Use prompt mode for function calling
    contextFields: [],
    runtime: new AxJSRuntime(),
  }
);

console.log('=== Function Call Mode Demo (Prompt Mode) ===');

// Example 1: Search query
console.log('\n1. Search query:');
const result1 = await smartAgent.forward(llm, {
  question: 'What is the population of Tokyo plus 10?',
});
console.log('Result:', result1);

// // Example 2: Calculation
// console.log('\n2. Calculation:');
// const result2 = await smartAgent.forward(llm, {
//   question: 'What is 15 * 23?',
// });
// console.log('Result:', result2);

// // Example 3: Complex query that might use both tools
// console.log('\n3. Complex query:');
// const result3 = await smartAgent.forward(llm, {
//   question:
//     'Search for the tallest building and calculate its height in meters if given in feet',
// });
// console.log('Result:', result3);
