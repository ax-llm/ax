import { AxAI, ax, f } from '@ax-llm/ax';

// Example showing how to use result picker to select from multiple samples

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create a generator that produces creative responses
const creativeGen = ax`
  topic:${f.string('A topic to write about')} ->
  title:${f.string('Creative title')},
  content:${f.string('Creative content')}
`;

// Example 1: Simple result picker that selects the shortest content
const shortestContentPicker = async (
  data:
    | {
        type: 'fields';
        results: readonly {
          index: number;
          sample: Partial<{ title: string; content: string }>;
        }[];
      }
    | {
        type: 'function';
        results: readonly {
          index: number;
          functionName: string;
          functionId: string;
          args: string | object;
          result: string;
          isError?: boolean;
        }[];
      }
) => {
  if (data.type === 'function') {
    // Handle function results - pick the first successful one
    console.log('\nFunction execution results:');
    data.results.forEach((result) => {
      console.log(
        `Function ${result.index}: ${result.functionName} - ${result.isError ? 'ERROR' : 'SUCCESS'}`
      );
    });

    const successfulIndex = data.results.findIndex((r) => !r.isError);
    const selectedIndex = successfulIndex >= 0 ? successfulIndex : 0;
    console.log(`Selected function result ${selectedIndex}`);
    return selectedIndex;
  }

  // Handle field results - pick the shortest content
  console.log('\nAll generated results:');
  data.results.forEach((result) => {
    console.log(
      `Option ${result.index}: ${result.sample.title} (${result.sample.content?.length || 0} chars)`
    );
  });

  // Find the result with the shortest content
  let shortestIndex = 0;
  let shortestLength = data.results[0]?.sample.content?.length || 0;

  for (let i = 1; i < data.results.length; i++) {
    const length = data.results[i]?.sample.content?.length || 0;
    if (length < shortestLength) {
      shortestLength = length;
      shortestIndex = data.results[i]?.index ?? 0;
    }
  }

  console.log(`Selected option ${shortestIndex} (shortest content)`);
  return shortestIndex;
};

// Test with multiple samples and result picker
const result1 = await creativeGen.forward(
  ai,
  { topic: 'The future of AI' },
  {
    sampleCount: 3,
    resultPicker: shortestContentPicker,
  }
);

console.log('\nSelected result:');
console.log(`Title: ${result1.title}`);
console.log(`Content: ${result1.content}`);

// Example 2: Result picker that uses LLM judge to select best result
const llmJudgePicker = async (
  data:
    | {
        type: 'fields';
        results: readonly {
          index: number;
          sample: Partial<{ title: string; content: string }>;
        }[];
      }
    | {
        type: 'function';
        results: readonly {
          index: number;
          functionName: string;
          functionId: string;
          args: string | object;
          result: string;
          isError?: boolean;
        }[];
      }
) => {
  console.log('\n=== LLM Judge Selection ===');

  if (data.type === 'function') {
    // For function results, just pick the first successful one
    console.log(
      'Function results detected - selecting first successful function'
    );
    const successfulIndex = data.results.findIndex((r) => !r.isError);
    return successfulIndex >= 0 ? successfulIndex : 0;
  }

  // Create a judge generator
  const judgeGen = ax`
    options:${f.string('List of title and content options')} ->
    selectedIndex:${f.number('Index of the best option (0-based)')},
    reasoning:${f.string('Reasoning for the selection')}
  `;

  // Format the options for the judge
  const optionsText = data.results
    .map(
      (result) =>
        `Option ${result.index}: Title: "${result.sample.title}", Content: "${result.sample.content}"`
    )
    .join('\n\n');

  console.log('Options sent to judge:');
  console.log(optionsText);

  const judgment = await judgeGen.forward(ai, {
    options: `Please select the best option from these creative writing samples based on creativity, coherence, and engagement:\n\n${optionsText}`,
  });

  console.log(`\nJudge reasoning: ${judgment.reasoning}`);
  console.log(`Judge selected index: ${judgment.selectedIndex}`);

  // Validate the index - ensure it's a number and map to actual result index
  const rawIndex =
    typeof judgment.selectedIndex === 'number' ? judgment.selectedIndex : 0;
  const clampedIndex = Math.max(
    0,
    Math.min(data.results.length - 1, Math.floor(rawIndex))
  );
  const selectedIndex = data.results[clampedIndex]?.index ?? 0;
  return selectedIndex;
};

// Test with LLM judge picker
console.log('\n=== Testing LLM Judge Picker ===');
const result2 = await creativeGen.forward(
  ai,
  { topic: 'Time travel paradoxes' },
  {
    sampleCount: 3,
    resultPicker: llmJudgePicker,
  }
);

console.log('\nLLM Judge selected result:');
console.log(`Title: ${result2.title}`);
console.log(`Content: ${result2.content}`);

// Example 3: Test with streaming
console.log('\n=== Testing Streaming with Result Picker ===');

const streamingResult = creativeGen.streamingForward(
  ai,
  { topic: 'The mysteries of the ocean' },
  {
    sampleCount: 2,
    resultPicker: shortestContentPicker,
  }
);

console.log('\nStreaming result:');
for await (const delta of streamingResult) {
  if (delta.delta.title) {
    console.log(`Title: ${delta.delta.title}`);
  }
  if (delta.delta.content) {
    console.log(`Content: ${delta.delta.content}`);
  }
}

// Example 4: Create a generator that uses functions to demonstrate function result picking
const functionGen = ax`
  query:${f.string('User query')} ->
  answer:${f.string('Final answer based on function results')}
`;

// Define a simple function
const getWeatherFunction = {
  name: 'getWeather',
  description: 'Get weather information for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'The location to get weather for',
      },
    },
    required: ['location'],
  },
  func: async (args: Readonly<{ location: string }>) => {
    // Simulate weather data
    return `The weather in ${args.location} is sunny with 72°F temperature.`;
  },
};

// Test result picker with functions
console.log('\n=== Testing Result Picker with Functions ===');

const result4 = await functionGen.forward(
  ai,
  { query: 'What is the weather like in San Francisco?' },
  {
    sampleCount: 2,
    functions: [getWeatherFunction],
    resultPicker: shortestContentPicker, // This will now receive function results if functions are called
  }
);

console.log('\nFunction-based result:');
console.log(`Answer: ${result4.answer}`);

console.log('\n=== Demo Complete ===');
