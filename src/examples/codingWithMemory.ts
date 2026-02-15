import {
  AxAI,
  AxAgent,
  AxJSInterpreterPermission,
  AxMCPClient,
  axCreateJSInterpreter,
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
const jsInterpreter = axCreateJSInterpreter({
  permissions: [AxJSInterpreterPermission.NETWORK],
});

// Create a coding assistant with memory
const codingAssistant = new AxAgent<
  { userQuery: string },
  { reply: string; codeResult?: string }
>({
  name: 'CodingAssistant',
  description:
    'You are a coding assistant that can remember past conversations and execute JavaScript code.',
  signature: 'userQuery -> reply, codeResult?',
  functions: [mcpClient, jsInterpreter.toFunction()],
});

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
