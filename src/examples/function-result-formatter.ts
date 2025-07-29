import { AxAI, ax, axGlobals } from '@ax-llm/ax';

console.log('=== Function Result Formatter Demo ===\n');

// Create an AI instance (using openai for the example)
const _ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY || 'test',
});

// Simple function that returns an object
const _getUserInfo = {
  name: 'get_user_info',
  description: 'Get user information',
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User ID' },
    },
    required: ['userId'],
  },
  func: async (args: { userId: string }) => {
    return {
      id: args.userId,
      name: 'John Doe',
      email: 'john@example.com',
      preferences: {
        theme: 'dark',
        notifications: true,
      },
    };
  },
};

console.log('1. Default Global Formatter (JSON.stringify with null, 2):');
console.log(
  '   Result:',
  axGlobals.functionResultFormatter({ name: 'John', age: 30 })
);
console.log();

console.log('2. Custom Global Formatter:');
// Change the global formatter
axGlobals.functionResultFormatter = (result: unknown) => {
  if (typeof result === 'object' && result !== null) {
    return `[CUSTOM] ${JSON.stringify(result, null, 0)}`;
  }
  return `[CUSTOM] ${String(result)}`;
};

console.log(
  '   Result:',
  axGlobals.functionResultFormatter({ name: 'John', age: 30 })
);
console.log();

console.log('3. Per-call Custom Formatter:');
// Per-call formatter that overrides the global one
const perCallFormatter = (result: unknown): string => {
  if (typeof result === 'object' && result !== null) {
    return `[PER-CALL] User data: ${JSON.stringify(result, null, 0)}`;
  }
  return `[PER-CALL] ${String(result)}`;
};

console.log('   Result:', perCallFormatter({ name: 'John', age: 30 }));
console.log();

// Create a generator
const _gen = ax(
  'userRequest:string "User request" -> responseText:string "AI response"'
);

console.log('4. Integration Example:');
console.log(
  '   - The functionResultFormatter can be passed as an option to forward()'
);
console.log(
  '   - It will be used to format function results before storing in memory'
);
console.log('   - Falls back to global formatter if not provided');
console.log();

console.log('   Example usage:');
console.log('   ```typescript');
console.log('   await gen.forward(ai, { userRequest: "Get user 123" }, {');
console.log('     functions: [getUserInfo],');
console.log('     functionResultFormatter: customFormatter');
console.log('   });');
console.log('   ```');
console.log();

// Reset global formatter to default
axGlobals.functionResultFormatter = (result: unknown) => {
  return typeof result === 'string'
    ? result
    : result === undefined || result === null
      ? ''
      : JSON.stringify(result, null, 2);
};

console.log('Demo completed! ✅');
