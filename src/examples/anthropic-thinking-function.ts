import { type AxAgentFunction, AxJSRuntime, agent, ai } from '@ax-llm/ax';

// Simple math tool to force tool use
const tools: AxAgentFunction[] = [
  {
    name: 'addNumbers',
    description: 'Add two numbers and return their sum',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
    func: ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
  },
];

const llm = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  options: { debug: true },
});

const mathAgent = agent(
  'userQuestion:string "User question" -> responseText:string "Final answer", rationale:string "Brief reasoning"',
  {
    ai: llm,
    functions: { local: tools },
    actorOptions: {
      description:
        'You are a precise math assistant. Use tools for any arithmetic. Provide a concise final answer and a short rationale.',
    },
    contextFields: [],
    runtime: new AxJSRuntime(),
  }
);

console.log('=== Anthropic + Tools + Thinking Demo ===');

try {
  // Turn 1: induce thinking without tool use, so we have preserved thinking blocks
  const turn1 = await mathAgent.forward(
    llm,
    {
      userQuestion:
        'Explain why showing your work in math helps find mistakes.',
    },
    {
      stream: false,
      thinkingTokenBudget: 'low',
      showThoughts: true,
      // Disable tools by not providing any function definitions for this turn
      functions: [],
    }
  );
  console.log('Turn1', {
    responseText: turn1.responseText,
    rationale: turn1.rationale,
  });

  // Turn 2: perform tool use with thinking still enabled; adapter will prepend preserved thinking
  const turn2 = await mathAgent.forward(
    llm,
    {
      userQuestion: 'Add 7 and 15 and explain briefly.',
    },
    {
      stream: false,
      thinkingTokenBudget: 'low',
      showThoughts: true,
      functionCall: 'auto',
    }
  );
  console.log('Turn2', {
    responseText: turn2.responseText,
    rationale: turn2.rationale,
  });
} catch (err) {
  console.error('Example failed:', err);
}
