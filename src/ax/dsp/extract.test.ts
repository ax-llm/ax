import { describe, expect, test } from 'vitest';

import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
} from './extract.js';
import { AxSignature } from './sig.js';

// Helper function to create a clean initial state
const createInitialState = (): extractionState => ({
  currField: undefined,
  extractedFields: [],
  streamedIndex: {},
  s: -1,
});

describe('extractValues', () => {
  test('extracts single output field', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer');
    const values: Record<string, unknown> = {};
    const content = 'Model Answer:This is the output content!';

    extractValues(sig, values, content);

    expect(values).toEqual({ modelAnswer: 'This is the output content!' });
  });

  test('extracts multiple output fields', () => {
    const sig = new AxSignature(
      'userQuestion1, userQuestion2 -> modelAnswer1, modelAnswer2'
    );
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1: First output content
Model Answer 2: Second\noutput\ncontent`;

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: 'First output content',
      modelAnswer2: 'Second\noutput\ncontent',
    });
  });

  test('preserves existing values', () => {
    const sig = new AxSignature(
      'userQuestion1, userQuestion2 -> modelAnswer1, modelAnswer2'
    );
    const values: Record<string, unknown> = {
      modelAnswer1: 'existing content',
    };
    const content = 'Model Answer 2: New content';

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: 'existing content',
      modelAnswer2: 'New content',
    });
  });

  test('handles multiline output content', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1, modelAnswer2');
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1: This is a multi-line
output content for field 1
Model Answer 2:And this is the
multi-line content for field 2`;

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: 'This is a multi-line\noutput content for field 1',
      modelAnswer2: 'And this is the\nmulti-line content for field 2',
    });
  });

  test('handles array output JSON', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1:string[]');
    const values: Record<string, unknown> = {};
    const content = 'Model Answer 1: ["test", "test2"]';

    extractValues(sig, values, content);

    expect(values).toEqual({ modelAnswer1: ['test', 'test2'] });
  });

  test('handles array output markdown', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1:string[]');
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1:
  - test
  - test2`;

    extractValues(sig, values, content);

    expect(values).toEqual({ modelAnswer1: ['test', 'test2'] });
  });

  // New test cases
  test('handles nested JSON objects', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1:json');
    const values: Record<string, unknown> = {};
    const content = 'Model Answer 1: {"name": "test", "values": [1, 2, 3]}';

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: {
        name: 'test',
        values: [1, 2, 3],
      },
    });
  });

  test('handles boolean values', () => {
    const sig = new AxSignature(
      'userQuestion -> modelAnswer1:boolean, modelAnswer2:boolean'
    );
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1: true
Model Answer 2: false`;

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: true,
      modelAnswer2: false,
    });
  });

  test('extractValues plan/restaurants scenario', () => {
    const sig = new AxSignature({
      inputs: [{ name: 'userInput' }],
      outputs: [
        { name: 'plan', title: 'Plan', type: { name: 'string' } },
        {
          name: 'get_current_weather_location',
          title: 'getCurrentWeather location',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_location',
          title: 'findRestaurants location',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_outdoor',
          title: 'findRestaurants outdoor',
          type: { name: 'boolean' },
        },
        {
          name: 'find_restaurants_cuisine',
          title: 'findRestaurants cuisine',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_price_range',
          title: 'findRestaurants priceRange',
          type: { name: 'string' },
          isOptional: true,
        },
      ],
    });

    const values: Record<string, unknown> = {};
    const content = `Plan: First, I will check the weather in San Francisco to determine if it's a nice day for outdoor seating. Then, I will search for restaurants in San Francisco that offer sushi, Chinese, or Indian cuisine, prioritizing outdoor seating if the weather is good. Finally, I will suggest a suitable restaurant.
getCurrentWeather location: San Francisco
findRestaurants location: San Francisco
findRestaurants cuisine: sushi, chinese, indian
findRestaurants outdoor: true
findRestaurants priceRange: $$-$$$
`;

    extractValues(sig, values, content);

    expect(values).toEqual({
      plan: "First, I will check the weather in San Francisco to determine if it's a nice day for outdoor seating. Then, I will search for restaurants in San Francisco that offer sushi, Chinese, or Indian cuisine, prioritizing outdoor seating if the weather is good. Finally, I will suggest a suitable restaurant.",
      get_current_weather_location: 'San Francisco',
      find_restaurants_location: 'San Francisco',
      find_restaurants_cuisine: 'sushi, chinese, indian',
      find_restaurants_outdoor: true,
      find_restaurants_price_range: '$$-$$$',
    });
  });
});

describe('streamingExtractValues', () => {
  test('handles streaming output fields', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1, modelAnswer2');
    const values: Record<string, unknown> = {};
    const state = createInitialState();

    // First chunk
    let content = 'Model Answer 1: First ';
    streamingExtractValues(sig, values, state, content);
    streamingExtractFinalValue(sig, values, state, content);
    content += 'output content\n';
    streamingExtractValues(sig, values, state, content);
    content += 'Model Answer 2: Second ';
    streamingExtractValues(sig, values, state, content);
    content += 'output content';
    streamingExtractFinalValue(sig, values, state, content, {
      strictMode: false,
    });

    expect(values).toEqual({
      modelAnswer1: 'First output content',
      modelAnswer2: 'Second output content',
    });
  });

  test('handles partial output label', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1');
    const values: Record<string, unknown> = {};
    const state = createInitialState();

    // Split in middle of "Output" label
    let content = 'Mod';
    streamingExtractValues(sig, values, state, content);
    content += 'el Answer 1: Content here';
    streamingExtractValues(sig, values, state, content);
    streamingExtractFinalValue(sig, values, state, content, {
      strictMode: false,
    });

    expect(values).toEqual({
      modelAnswer1: 'Content here',
    });
  });

  test('handles incremental content with multiple fields', () => {
    const sig = new AxSignature(
      'userQuestion -> modelAnswer1, modelAnswer2, modelAnswer3'
    );
    const values: Record<string, unknown> = {};
    const state = createInitialState();

    // Send content in chunks
    const chunks = [
      'Model Answer 1: First',
      ' content here\n',
      'Model Answer 2: Sec',
      'ond content\n',
      'Model Answer 3: Third content',
    ];

    let content = '';

    for (const chunk of chunks) {
      content += chunk;
      streamingExtractValues(sig, values, state, content);
    }
    streamingExtractFinalValue(sig, values, state, content, {
      strictMode: false,
    });

    expect(values).toEqual({
      modelAnswer1: 'First content here',
      modelAnswer2: 'Second content',
      modelAnswer3: 'Third content',
    });
  });

  // New test case
  test('handles streaming JSON array content', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1:string[]');
    const values: Record<string, unknown> = {};
    const state = createInitialState();

    let content = 'Model Answer 1: ["first"';
    streamingExtractValues(sig, values, state, content);
    content += ', "second", ';
    streamingExtractValues(sig, values, state, content);
    content += '"third"]';
    streamingExtractFinalValue(sig, values, state, content, {
      strictMode: false,
    });

    expect(values).toEqual({
      modelAnswer1: ['first', 'second', 'third'],
    });
  });

  test('does not append next field content to previous field (restaurant plan scenario)', () => {
    const sig = new AxSignature({
      inputs: [{ name: 'userInput' }],
      outputs: [
        { name: 'plan', title: 'Plan', type: { name: 'string' } },
        {
          name: 'get_current_weather_location',
          title: 'getCurrentWeather location',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_location',
          title: 'findRestaurants location',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_outdoor',
          title: 'findRestaurants outdoor',
          type: { name: 'boolean' },
        },
        {
          name: 'find_restaurants_cuisine',
          title: 'findRestaurants cuisine',
          type: { name: 'string' },
        },
        {
          name: 'find_restaurants_price_range',
          title: 'findRestaurants priceRange',
          type: { name: 'string' },
          isOptional: true,
        },
      ],
    });
    const values: Record<string, unknown> = {};
    const state = createInitialState();

    const content = `Plan: First, I will check the weather in San Francisco to determine if it's a nice day for outdoor seating. Then, I will search for restaurants in San Francisco that offer sushi, Chinese, or Indian cuisine, prioritizing outdoor seating if the weather is good. Finally, I will suggest a suitable restaurant.
getCurrentWeather location: San Francisco
findRestaurants location: San Francisco
findRestaurants outdoor: true
findRestaurants cuisine: sushi, chinese, indian
findRestaurants priceRange: $$-$$$`;

    streamingExtractValues(sig, values, state, content);

    expect(values).toMatchObject({
      plan: "First, I will check the weather in San Francisco to determine if it's a nice day for outdoor seating. Then, I will search for restaurants in San Francisco that offer sushi, Chinese, or Indian cuisine, prioritizing outdoor seating if the weather is good. Finally, I will suggest a suitable restaurant.",
      get_current_weather_location: 'San Francisco',
      find_restaurants_location: 'San Francisco',
      find_restaurants_outdoor: true,
      find_restaurants_cuisine: 'sushi, chinese, indian',
    });
  });
});

describe('error handling', () => {
  test('handles empty and whitespace content', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1?, modelAnswer2?');
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1: 
Model Answer 2:    
Model Answer:`;

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: undefined,
      modelAnswer2: 'Model Answer:',
    });
  });

  test('handles malformed content', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1, modelAnswer2');
    const values: Record<string, unknown> = {};
    const malformedContent = 'Some random content without output prefix';

    expect(() => extractValues(sig, values, malformedContent)).toThrow(
      'Required field not found'
    );
  });

  // New test cases
  test('throws validation error for invalid markdown list', () => {
    const sig = new AxSignature('userQuestion -> modelAnswer1:string[]');
    const values: Record<string, unknown> = {};
    const content = `Model Answer 1:
    - test
    invalid format
    - test2`;

    expect(() => extractValues(sig, values, content)).toThrow(
      'Invalid Array: Could not parse markdown list'
    );
  });

  test('handles missing optional fields', () => {
    const sig = new AxSignature(
      'userQuestion -> modelAnswer1, modelAnswer2?:string'
    );
    const values: Record<string, unknown> = {};
    const content = 'Model Answer 1: Only field one is present';

    extractValues(sig, values, content);

    expect(values).toEqual({
      modelAnswer1: 'Only field one is present',
    });
  });
});
