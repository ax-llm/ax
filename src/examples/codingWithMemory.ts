import {
  AxAI,
  type AxFunction,
  AxJSRuntime,
  AxJSRuntimePermission,
  AxMCPClient,
  agent,
  axCreateJSRuntime,
} from '@ax-llm/ax';
import { axCreateMCPStdioTransport } from '@ax-llm/ax-tools';

// Setup MCP client for memory
const mcpTransport = axCreateMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});
const mcpClient = new AxMCPClient(mcpTransport, { debug: false });
await mcpClient.init();

// Setup JS interpreter for code execution
const jsRuntime = axCreateJSRuntime({
  permissions: [AxJSRuntimePermission.NETWORK],
});

const toAgentFunctions = (functions: AxFunction[]): AxFunction[] =>
  functions.map((fn) => ({
    ...fn,
    parameters: fn.parameters ?? { type: 'object', properties: {} },
  }));

const functions = toAgentFunctions([
  ...mcpClient.toFunction(),
  jsRuntime.toFunction(),
]);

// Create a coding assistant with memory
const codingAssistant = agent(
  'userQuery:string -> reply:string, codeResult?:string "You are a coding assistant that can remember past conversations and execute JavaScript code."',
  {
    functions: { local: functions },
    contextFields: [],
    runtime: new AxJSRuntime(),
  }
);

// Initialize AI
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { stream: true },
});

// Use the combined assistant
const result = await codingAssistant.forward(
  ai,
  {
    userQuery:
      'Calculate the sum of the first 10 fibonacci numbers and remember the result.',
  },
  {
    debug: true,
  }
);

console.log('Assistant Response:', result);
