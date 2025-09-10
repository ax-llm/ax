#!/usr/bin/env node

import { AxAIAnthropicModel, ai, ax } from '@ax-llm/ax';

// Reusable generator: include optional thought field to capture reasoning when available
export const reasoningGen = ax(
  'userQuestion:string "User question" -> responseText:string "Final answer", thought?:string "Reasoning tokens (if available)"'
);

console.log('=== Anthropic thinking separation demo ===');

const llmWithThoughts = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: {
    model: AxAIAnthropicModel.Claude37Sonnet,
    stream: false,
    temperature: 0.1,
  },
  options: {
    thinkingTokenBudget: 'low',
    showThoughts: true,
  },
});

const withThoughts = await reasoningGen.forward(llmWithThoughts, {
  userQuestion:
    'In one sentence, explain why the sky appears blue on a clear day.',
});

console.log('[showThoughts=true] answer:', withThoughts.responseText);
if (withThoughts.thought)
  console.log('[showThoughts=true] thought:', withThoughts.thought);

const llmNoThoughts = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: {
    model: AxAIAnthropicModel.Claude37Sonnet,
    stream: false,
    temperature: 0.1,
  },
  options: {
    thinkingTokenBudget: 'low',
    showThoughts: false,
  },
});

const noThoughts = await reasoningGen.forward(llmNoThoughts, {
  userQuestion:
    'In one sentence, explain why the sky appears blue on a clear day.',
});

console.log('[showThoughts=false] answer:', noThoughts.responseText);
console.log('[showThoughts=false] thought:', String(noThoughts.thought ?? ''));
