import { ax, f } from '@ax-llm/ax';
import { AxAIGoogleGemini } from '@ax-llm/ax/ai/google-gemini/api.js';

console.log('=== Configurable Thinking Token Budget Levels Demo ===\n');

// Example 1: Default thinking token budget levels
console.log('1. Default thinking token budget levels:');
const defaultAI = new AxAIGoogleGemini({
  apiKey: process.env.GOOGLE_APIKEY!,
});

const reasoningGenerator = ax`
  question:${f.string('Complex reasoning question')} -> 
  answer:${f.string('Detailed answer with reasoning')}
`;

try {
  const defaultResult = await reasoningGenerator.forward(
    defaultAI,
    {
      question:
        'Explain the concept of recursion in programming with examples.',
    },
    { thinkingTokenBudget: 'medium' }
  );
  console.log(
    'Default medium level result length:',
    (defaultResult.answer as string)?.length || 0
  );
} catch {
  console.log('Default levels example skipped (no API key)');
}
console.log();

// Example 2: Custom thinking token budget levels
console.log('2. Custom thinking token budget levels:');
const customAI = new AxAIGoogleGemini({
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    thinkingTokenBudgetLevels: {
      minimal: 50, // Very minimal reasoning
      low: 200, // Light reasoning
      medium: 1000, // Moderate reasoning
      high: 5000, // Extensive reasoning
      highest: 15000, // Maximum reasoning (within limits)
    },
  },
});

try {
  const customResult = await reasoningGenerator.forward(
    customAI,
    {
      question:
        'Explain the concept of recursion in programming with examples.',
    },
    { thinkingTokenBudget: 'medium' }
  );
  console.log(
    'Custom medium level result length:',
    (customResult.answer as string)?.length || 0
  );
} catch {
  console.log('Custom levels example skipped (no API key)');
}
console.log();

// Example 3: Comparing different levels
console.log('3. Comparing different thinking levels:');
const comparisonAI = new AxAIGoogleGemini({
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    thinkingTokenBudgetLevels: {
      minimal: 100,
      low: 500,
      medium: 2000,
      high: 8000,
      highest: 20000,
    },
  },
});

const simpleQuestion = 'What is 2 + 2?';

try {
  console.log('Testing different thinking levels for the same question...');

  const minimalResult = await reasoningGenerator.forward(
    comparisonAI,
    { question: simpleQuestion },
    { thinkingTokenBudget: 'minimal' }
  );
  console.log(
    '- Minimal level answer length:',
    (minimalResult.answer as string)?.length || 0
  );

  const highResult = await reasoningGenerator.forward(
    comparisonAI,
    { question: simpleQuestion },
    { thinkingTokenBudget: 'high' }
  );
  console.log(
    '- High level answer length:',
    (highResult.answer as string)?.length || 0
  );
} catch {
  console.log('Level comparison example skipped (no API key)');
}
console.log();

// Example 4: Using with showThoughts
console.log('4. Using with showThoughts:');
const thoughtsAI = new AxAIGoogleGemini({
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    thinkingTokenBudgetLevels: {
      minimal: 150,
      low: 600,
      medium: 2500,
      high: 10000,
      highest: 24000,
    },
  },
});

try {
  const thoughtsResult = await reasoningGenerator.forward(
    thoughtsAI,
    { question: 'Why is the sky blue?' },
    {
      thinkingTokenBudget: 'high',
      showThoughts: true,
    }
  );
  console.log('High level with thoughts enabled');
  console.log(
    '- Answer length:',
    (thoughtsResult.answer as string)?.length || 0
  );
  console.log('- Has reasoning thoughts:', !!thoughtsResult.thought);
} catch {
  console.log('ShowThoughts example skipped (no API key)');
}
console.log();

// Example 5: Disabling thinking with 'none'
console.log('5. Disabling thinking with "none":');
try {
  const noThinkingResult = await reasoningGenerator.forward(
    thoughtsAI,
    { question: 'What is the capital of France?' },
    {
      thinkingTokenBudget: 'none',
      showThoughts: true, // This will be overridden to false
    }
  );
  console.log('No thinking level result');
  console.log(
    '- Answer length:',
    (noThinkingResult.answer as string)?.length || 0
  );
  console.log('- Has reasoning thoughts:', !!noThinkingResult.thought);
  console.log('- Note: showThoughts was automatically disabled');
} catch {
  console.log('No thinking example skipped (no API key)');
}
console.log();

console.log('=== Configurable Thinking Token Budget Levels Demo Complete ===');
console.log('');
console.log('Usage examples:');
console.log('- const ai = new AxAIGoogleGemini({');
console.log('    config: {');
console.log('      thinkingTokenBudgetLevels: {');
console.log('        minimal: 100,');
console.log('        low: 500,');
console.log('        medium: 2000,');
console.log('        high: 8000,');
console.log('        highest: 20000,');
console.log('      }');
console.log('    }');
console.log('  })');
console.log(
  '- await generator.forward(ai, input, { thinkingTokenBudget: "medium" })'
);
