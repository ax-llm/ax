/**
 * Gemini Multi-Turn Function Calling with Caching Example
 *
 * This example demonstrates how caching works with multi-turn function calling:
 *
 * 1. **Tools caching** - Last tool automatically marked for caching (breakpoint #1)
 * 2. **System prompt caching** - Always cached (breakpoint #2)
 * 3. **Function results caching** - Last result automatically marked (breakpoint #3)
 *
 * Each turn benefits from cached prefix, reducing costs by up to 90%.
 *
 * Run: npx tsx src/examples/gemini-function-cache.ts
 */

import {
  AxAIGoogleGemini,
  AxAIGoogleGeminiModel,
  type AxFunction,
  AxGen,
} from '@ax-llm/ax';

// Define tools for the agent
const tools: AxFunction[] = [
  {
    name: 'getCurrentTime',
    description: 'Get the current date and time',
    parameters: {
      type: 'object',
      properties: {},
    },
    func: () => {
      const now = new Date();
      return {
        timestamp: now.toISOString(),
        formatted: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to evaluate (e.g., "2 + 2 * 3")',
        },
      },
      required: ['expression'],
    },
    func: ({ expression }: { expression: string }) => {
      try {
        // Simple eval for demo - in production use a proper math parser
        const result = Function(`"use strict"; return (${expression})`)();
        return { expression, result, success: true };
      } catch (e) {
        return {
          expression,
          error: (e as Error).message,
          success: false,
        };
      }
    },
  },
  {
    name: 'getWeather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city name',
        },
      },
      required: ['city'],
    },
    func: ({ city }: { city: string }) => {
      // Mock weather data
      const weatherData: Record<string, object> = {
        'new york': { temp: 72, condition: 'Sunny', humidity: 45 },
        london: { temp: 58, condition: 'Cloudy', humidity: 78 },
        tokyo: { temp: 68, condition: 'Clear', humidity: 55 },
        paris: { temp: 64, condition: 'Partly Cloudy', humidity: 62 },
      };
      const data = weatherData[city.toLowerCase()] || {
        temp: 70,
        condition: 'Unknown',
        humidity: 50,
      };
      return { city, ...data, unit: 'fahrenheit' };
    },
  },
];

// Large system prompt to ensure caching is effective
const SYSTEM_PROMPT = `
You are a helpful assistant with access to tools. You can:
1. Get the current time using getCurrentTime
2. Calculate math expressions using calculate
3. Get weather information using getWeather

When answering questions:
- Use the appropriate tools to gather information
- Combine results from multiple tools when needed
- Provide clear, formatted responses

You are knowledgeable about:
- Time zones and date formatting
- Mathematical operations and expressions
- Weather patterns and conditions

Always be helpful and use your tools effectively.
`.repeat(10); // Repeat to exceed minimum cache threshold

async function runMultiTurnAgent() {
  const ai = new AxAIGoogleGemini({
    apiKey: process.env.GOOGLE_APIKEY,
    config: {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
    },
  });

  // Create agent with tools
  const agent = new AxGen<{ question: string }, { answer: string }>(
    'question -> answer',
    {
      description: SYSTEM_PROMPT,
      functions: tools,
    }
  );

  console.log('=== Multi-Turn Function Calling with Caching ===\n');
  console.log('This demo shows how caching optimizes multi-turn tool use:\n');
  console.log('- Tools are cached (last tool gets cache breakpoint)');
  console.log('- System prompt is cached');
  console.log('- Function results are cached (last result gets breakpoint)\n');

  // Questions that will trigger multiple tool calls
  const questions = [
    "What's the current time and what's 15 * 24?",
    "What's the weather in Tokyo and London? Also, what's 100 / 4?",
    'Calculate 2^10 and tell me the current time again',
  ];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`\n--- Question ${i + 1} ---`);
    console.log(`Q: ${question}\n`);

    const startTime = Date.now();

    const result = await agent.forward(
      ai,
      { question },
      {
        debug: true, // Enable to see cache usage in logs
        // Context caching is automatic - tools and function results
        // are automatically marked for caching
      }
    );

    const elapsed = Date.now() - startTime;

    console.log(`A: ${result.answer}`);
    console.log(`\n(Completed in ${elapsed}ms)`);

    if (i > 0) {
      console.log(
        '↑ Subsequent turns benefit from cached tools + previous results'
      );
    }
  }

  console.log('\n=== Demo Complete ===');
  console.log('\nCaching benefits in multi-turn function calling:');
  console.log('1. Tools cached after first request');
  console.log('2. Each function result cached as breakpoint');
  console.log('3. Subsequent turns read from cache (90% cost reduction)');
}

async function main() {
  if (!process.env.GOOGLE_APIKEY) {
    console.error('Please set GOOGLE_APIKEY environment variable');
    console.error('Example: export GOOGLE_APIKEY=your-api-key');
    process.exit(1);
  }

  try {
    await runMultiTurnAgent();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
