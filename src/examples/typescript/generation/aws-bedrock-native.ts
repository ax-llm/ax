// ax-example:start
// title: TypeScript Native AWS Bedrock Tools and Streaming
// group: generation
// description: Runs a Claude tool round trip and streams the final answer through Bedrock Converse.
// provider: aws-bedrock
// env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
// level: intermediate
// order: 60
// ax-example:end
import { AxAIBedrock, AxAIBedrockModel } from '@ax-llm/ax-ai-aws-bedrock';

const model = AxAIBedrockModel.ClaudeSonnet5;
const bedrock = new AxAIBedrock({
  region: process.env.AWS_REGION ?? 'us-east-2',
  fallbackRegions: ['us-west-2', 'us-east-1'],
  config: { model, maxTokens: 4096 },
});

const weather = {
  name: 'current_weather',
  description: 'Read the current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
};

const userMessage = {
  role: 'user' as const,
  content: 'What should I wear for today in Vancouver?',
};
const toolRequest = await bedrock.chat(
  {
    model,
    chatPrompt: [
      { role: 'system', content: 'Use tools for current facts.', cache: true },
      userMessage,
    ],
    functions: [weather],
    functionCall: 'required',
  },
  {
    contextCache: { ttlSeconds: 3600 },
    thinkingTokenBudget: 'medium',
  }
);

if (toolRequest instanceof ReadableStream) {
  throw new Error('Expected the tool request to be non-streaming.');
}

const assistant = toolRequest.results[0];
const call = assistant?.functionCalls?.[0];
if (!call) throw new Error('Claude did not request the weather tool.');

const toolResult = JSON.stringify({
  city: 'Vancouver',
  conditions: 'light rain',
  temperatureC: 14,
});

const stream = await bedrock.chat(
  {
    model,
    chatPrompt: [
      { role: 'system', content: 'Use tools for current facts.', cache: true },
      userMessage,
      {
        role: 'assistant',
        content: assistant.content,
        functionCalls: assistant.functionCalls,
        thoughtBlocks: assistant.thoughtBlocks,
      },
      { role: 'function', functionId: call.id, result: toolResult },
    ],
    functions: [weather],
  },
  {
    stream: true,
    contextCache: { ttlSeconds: 3600 },
    thinkingTokenBudget: 'medium',
  }
);

if (!(stream instanceof ReadableStream)) {
  throw new Error('Expected a streaming Bedrock response.');
}

const reader = stream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(value.results[0]?.content ?? '');
}
process.stdout.write('\n');
