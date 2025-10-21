#!/usr/bin/env node

import { AxAIAnthropicModel, ai, ax } from '@ax-llm/ax';

// Reusable generator: include optional thought field to capture reasoning when available
export const reasoningGen = ax(
  'userQuestion:string "User question" -> responseText:string "Final answer", thought?:string "Reasoning tokens (if available)"'
);

console.log('=== Anthropic thinking  demo ===');

const llmWithThoughts = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: {
    model: AxAIAnthropicModel.Claude4Sonnet,
    stream: false,
    temperature: 0.1,
  },
  options: {
    thinkingTokenBudget: 'low',
    showThoughts: true,
  },
});

await reasoningGen.forward(
  llmWithThoughts,
  {
    userQuestion:
      'In one sentence, explain why the sky appears blue on a clear day.',
  },
  {
    showThoughts: true,
    thinkingTokenBudget: 'low',
    debug: true,
  }
);
