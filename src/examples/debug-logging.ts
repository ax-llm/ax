#!/usr/bin/env -S npx tsx
import {
  AxAI,
  AxAIGoogleGeminiModel,
  type AxFunction,
  AxGen,
} from '@ax-llm/ax';

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

// Enable debug mode to see logging
ai.setOptions({ debug: true });

// Create a simple function that will be called to demonstrate multi-step behavior
const getCurrentTime = (): string => {
  return new Date().toISOString();
};

const functions: AxFunction[] = [
  {
    name: 'getCurrentTime',
    description: 'Get the current date and time',
    func: getCurrentTime,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

const gen = new AxGen<{ task: string }, { plan: string; reportText: string }>(
  'task:string -> plan:string "step-by-step plan", reportText:string "final report text"',
  {
    functions,
  }
);

console.log('=== Multi-Step Processing with Function Calls ===');
console.log('Step 1 (firstStep=true): Shows full system prompt');
console.log(
  'Step 2+ (firstStep=false): Hides system prompt for cleaner output\n'
);

try {
  const result = await gen.forward(
    ai,
    {
      task: 'Create a timestamp-based report. First get the current time, then create a summary report with that timestamp.',
    },
    {
      maxSteps: 3, // Allow multiple steps for function calling
      debug: true,
      functions,
    }
  );

  console.log('\n✅ Final result:');
  console.log('Plan:', result.plan);
  console.log('Report:', result.reportText);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : error);
}

console.log('\n=== Simple Single Step for Comparison ===');

const simpleGen = new AxGen<{ question: string }, { answer: string }>(
  'question:string -> answer:string "simple answer"'
);

try {
  const result = await simpleGen.forward(
    ai,
    { question: 'What is 2+2?' },
    {
      maxSteps: 1,
      debug: true,
    }
  );

  console.log('\n✅ Simple result:', result.answer);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : error);
}

console.log('\n=== Multiple Samples with Result Picker ===');

const multiSampleGen = new AxGen<
  { topic: string },
  { title: string; content: string }
>(
  'topic:string -> title:string "engaging title", content:string "interesting content"'
);

try {
  const result = await multiSampleGen.forward(
    ai,
    { topic: 'Future of AI' },
    {
      sampleCount: 3, // Generate 3 samples
      debug: true,
      resultPicker: (_samples) => {
        // Just pick the first sample for demo purposes
        return 0;
      },
    }
  );

  console.log('\n✅ Result picker result:');
  console.log('Title:', result.title);
  console.log('Content length:', result.content.length);
} catch (error) {
  console.log('Error:', error instanceof Error ? error.message : error);
}

console.log('\n=== Force Multi-Step Processing ===');

const multiStepGen = new AxGen<{ input: string }, { output: string }>(
  'input:string -> output:string "processed output"'
);

try {
  const result = await multiStepGen.forward(
    ai,
    { input: 'Force multiple steps by using maxSteps=3' },
    {
      maxSteps: 3, // Force multiple steps
      debug: true,
      // Add a function call to force step progression
      functions: [
        {
          name: 'processStep',
          description: 'Process a step',
          func: () => 'step processed',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    }
  );

  console.log('\n✅ Multi-step result:', result.output);
} catch (error) {
  console.log(
    'Multi-step error:',
    error instanceof Error ? error.message : error
  );
}

console.log('\n📝 Key Behavior:');
console.log('- debugHideSystemPrompt: false for first step (step 0)');
console.log('- debugHideSystemPrompt: true for subsequent steps (step 1+)');
console.log('- Retries within the same step still show system prompt');
console.log('- Only actual step progression hides the system prompt');
