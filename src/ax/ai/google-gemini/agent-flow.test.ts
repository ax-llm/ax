import { describe, expect, it, vi } from 'vitest';
import { type AxFunction, agent, s } from '../../index.js';
import { AxAIGoogleGemini } from './api.js';
import { AxAIGoogleGeminiModel } from './types.js';

// Mock fetch to simulate Gemini responses
function createMockFetch(responses: any[]) {
  let callCount = 0;
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const count = callCount++;
      const response = responses[count];
      if (!response) {
        console.error(`Mock fetch called too many times: ${count + 1}`);
        return new Response(JSON.stringify({ error: 'Mock fetch exhausted' }), {
          status: 500,
        });
      }
      // Capture the request body for verification
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        (response as any)._capturedRequest = body;
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('Gemini 3 Agent Flow Verification', () => {
  it('should handle thought signatures correctly in a multi-turn agent flow', async () => {
    // 1. Setup Mocks
    // Response 1: Model decides to call getCurrentWeather
    const response1 = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'getCurrentWeather',
                  args: { location: 'San Francisco' },
                },
                thoughtSignature: 'signature_turn_1',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };

    // Response 2: Model decides to call findRestaurants based on weather
    const response2 = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'findRestaurants',
                  args: {
                    location: 'San Francisco',
                    outdoor: true,
                    cuisine: 'sushi',
                    priceRange: '$$',
                  },
                },
                thoughtSignature: 'signature_turn_2',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };

    // Response 3: Model gives final answer
    const response3 = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Plan: I found a great sushi place with outdoor seating.\nRestaurant: Sukiyabashi Jiro',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };

    const response4 = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Extra response just in case.' }],
          },
          finishReason: 'STOP',
        },
      ],
    };

    const fetch = createMockFetch([response1, response2, response3, response4]);

    // 2. Setup AI and Agent
    const llm = new AxAIGoogleGemini({
      apiKey: 'fake-key',
      config: { model: AxAIGoogleGeminiModel.Gemini3ProPreview },
    });
    llm.setOptions({ fetch });

    const weatherAPI = (_: Readonly<{ location: string }>) => {
      return { temperature: '27C', description: 'Clear Sky' };
    };

    const opentableAPI = ({ priceRange }: any) => {
      return [{ name: 'Sukiyabashi Jiro', price_range: priceRange }];
    };

    const functions: AxFunction[] = [
      {
        name: 'getCurrentWeather',
        description: 'get weather',
        func: weatherAPI,
        parameters: {
          type: 'object',
          properties: { location: { type: 'string', description: 'location' } },
        },
      },
      {
        name: 'findRestaurants',
        description: 'find restaurants',
        func: opentableAPI,
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'location' },
            outdoor: { type: 'boolean', description: 'outdoor seating' },
            cuisine: { type: 'string', description: 'cuisine type' },
            priceRange: { type: 'string', description: 'price range' },
          },
        },
      },
    ];

    const sig = s(`customerQuery:string -> plan: string, restaurant:string`);

    const gen = agent(sig, {
      name: 'food-search-test',
      functions,
      description:
        'A helpful agent that finds restaurants and checks weather for customers.',
    });

    // 3. Run Agent
    const _res = await gen.forward(
      llm,
      { customerQuery: 'Lunch in SF, sushi, nice weather' },
      { stream: false } // Agent usually streams, but for test simplicity we can disable or handle it.
      // Actually agent.forward with stream:true returns a generator.
      // Let's use stream: false to get the final result directly if supported,
      // or just iterate if it returns a generator.
      // The example used stream: true. Let's stick to default or false if possible.
      // AxAgent.forward returns Promise<T> if stream is false (default? no, check types).
      // Let's assume stream: false returns the result.
    );

    // 4. Verify Requests
    // We need to check if the signatures were passed back in the subsequent requests.

    // Request 1: Initial query (no signature expected)
    const req1 = (response1 as any)._capturedRequest;
    expect(req1).toBeDefined();

    // Request 2: Sending back weather result. Should include signature from Response 1.
    const req2 = (response2 as any)._capturedRequest;
    expect(req2).toBeDefined();
    // The history should contain:
    // User: Query
    // Model: Call Weather (with signature)
    // User: Weather Result
    const modelMsg1 = req2.contents.find((c: any) => c.role === 'model');
    expect(modelMsg1).toBeDefined();
    expect(modelMsg1.parts[0].functionCall.name).toBe('getCurrentWeather');
    expect(modelMsg1.parts[0].thought_signature).toBe('signature_turn_1');

    // Request 3: Sending back restaurant result. Should include signature from Response 2.
    const req3 = (response3 as any)._capturedRequest;
    expect(req3).toBeDefined();
    // History:
    // ...
    // Model: Call Restaurants (with signature)
    // User: Restaurant Result
    // We need to find the *second* model message (or the last one before the new user message)
    const modelMsgs = req3.contents.filter((c: any) => c.role === 'model');
    const lastModelMsg = modelMsgs[modelMsgs.length - 1];
    expect(lastModelMsg.parts[0].functionCall.name).toBe('findRestaurants');
    expect(lastModelMsg.parts[0].thought_signature).toBe('signature_turn_2');

    // Also verify the first signature is still there in the history
    const firstModelMsg = modelMsgs[0];
    expect(firstModelMsg.parts[0].thought_signature).toBe('signature_turn_1');
  }, 20000);
});
