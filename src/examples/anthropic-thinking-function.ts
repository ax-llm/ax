import { type AxFunction, agent, ai } from '@ax-llm/ax';

// Simple math tool to force tool use
const tools: AxFunction[] = [
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
    name: 'math-helper',
    description: 'Answers math questions. Use tools for arithmetic.',
    definition:
      'You are a precise math assistant. Use tools for any arithmetic. Provide a concise final answer and a short rationale.',
    ai: llm,
    functions: tools,
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
  const r1 = turn1.results?.[0];
  console.log('Turn1', {
    thought: r1?.thoughtBlock?.data ?? r1?.thought ?? '',
    encrypted: r1?.thoughtBlock?.encrypted ?? false,
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
  const r2 = turn2.results?.[0];
  console.log('Turn2', {
    responseText: r2?.content ?? r2?.name ?? '',
    thought: r2?.thoughtBlock?.data ?? r2?.thought ?? '',
    encrypted: r2?.thoughtBlock?.encrypted ?? false,
  });
} catch (err) {
  console.error('Example failed:', err);
}
