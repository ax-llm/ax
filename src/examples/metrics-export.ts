import { AxAI, AxAIOpenAIModel, type AxChatResponse, ax } from '@ax-llm/ax';
import { metrics } from '@opentelemetry/api';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

// Example: Complete metrics setup and usage demonstration
console.log('=== Ax AI Enhanced Metrics Demo ===');

// Initialize OpenTelemetry metrics with console export
const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 5000, // Export every 5 seconds
    }),
  ],
});

// Set the global meter provider
metrics.setGlobalMeterProvider(meterProvider);

// Create AI instance with metrics enabled
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT41Mini },
  options: {
    meter: metrics.getMeter('ax-ai-demo'),
    debug: true,
  },
});

// Example generators to test different metric scenarios
const chatGen = ax(
  'userQuestion:string "User question" -> responseText:string "AI response"'
);

// Demo 1: Basic chat with metrics (non-streaming)
console.log('\n--- Demo 1: Basic Chat Metrics ---');
const basicResult = await chatGen.forward(
  ai,
  {
    userQuestion: 'What are the benefits of TypeScript over JavaScript?',
  },
  { stream: false }
);
console.log(
  'Basic chat result:',
  `${(basicResult.responseText as string).substring(0, 100)}...`
);

// Demo 2: Streaming chat (tests streaming metrics)
console.log('\n--- Demo 2: Streaming Chat Metrics ---');
const streamingResult = await chatGen.forward(
  ai,
  {
    userQuestion: 'Explain async/await in JavaScript',
  },
  { stream: true }
);

if (streamingResult instanceof ReadableStream) {
  console.log('Streaming response initiated...');
  const reader = streamingResult.getReader();
  let response = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.results?.[0]?.content) {
        response += value.results[0].content;
      }
    }
  } finally {
    reader.releaseLock();
  }
  console.log(
    'Streaming response complete:',
    `${response.substring(0, 100)}...`
  );
}

// Demo 3: Multimodal request (tests multimodal metrics) - force non-streaming
console.log('\n--- Demo 3: Multimodal Request Metrics ---');
const multimodalResult = (await ai.chat({
  chatPrompt: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Describe what you would see in a simple geometric image',
        },
      ],
    },
  ],
  modelConfig: { stream: false },
})) as AxChatResponse;

console.log(
  'Multimodal result:',
  `${multimodalResult.results?.[0]?.content?.substring(0, 100)}...`
);

// Demo 4: Function calling (tests function call metrics) - force non-streaming
console.log('\n--- Demo 4: Function Calling Metrics ---');
const functionResult = (await ai.chat({
  chatPrompt: [{ role: 'user', content: 'Calculate the sum of 25 and 17' }],
  functions: [
    {
      name: 'calculateSum',
      description: 'Adds two numbers together',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
    },
  ],
  modelConfig: { stream: false },
})) as AxChatResponse;

// Handle function call if present
if (functionResult.results[0]?.functionCalls) {
  console.log(
    'Function call detected:',
    functionResult.results[0].functionCalls[0]?.function.name
  );
}

// Demo 5: Large prompt (tests prompt length metrics) - force non-streaming
console.log('\n--- Demo 5: Large Prompt Metrics ---');
const longPrompt = `${'Lorem ipsum dolor sit amet, '.repeat(50)}What is the meaning of this text?`;
const largePromptResult = await chatGen.forward(
  ai,
  {
    userQuestion: longPrompt,
  },
  { stream: false }
);
console.log(
  'Large prompt result:',
  `${(largePromptResult.responseText as string).substring(0, 100)}...`
);

// Demo 6: High temperature (tests model config metrics) - force non-streaming
console.log('\n--- Demo 6: Model Configuration Metrics ---');
const creativeResult = (await ai.chat({
  chatPrompt: [
    {
      role: 'user',
      content: 'Write a creative short story about a robot learning to paint',
    },
  ],
  modelConfig: {
    temperature: 0.9,
    maxTokens: 150,
    topP: 0.8,
    stream: false,
  },
})) as AxChatResponse;

console.log(
  'Creative result:',
  `${creativeResult.results?.[0]?.content?.substring(0, 100)}...`
);

// Demo 7: Error handling (tests timeout/abort metrics)
console.log('\n--- Demo 7: Error Handling Metrics ---');
try {
  const shortTimeoutResult = (await ai.chat(
    {
      chatPrompt: [{ role: 'user', content: 'This should work normally' }],
    },
    {
      timeout: 30000, // 30 seconds should be enough
      stream: false,
    }
  )) as AxChatResponse;

  console.log(
    'No timeout occurred:',
    `${shortTimeoutResult.results?.[0]?.content?.substring(0, 50)}...`
  );
} catch (error) {
  console.log(
    'Error occurred (metrics recorded):',
    error instanceof Error ? error.message : 'Unknown error'
  );
}

export { chatGen };
