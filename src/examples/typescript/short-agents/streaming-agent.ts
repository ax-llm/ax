// ax-example:start
// title: TypeScript Streaming Agent
// group: short-agents
// description: Streams an agent's answer as field deltas while its evidence citations are checked against what the agent read from a handbook kept out of the prompt.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 15
// ax-example:end
import { AxAIOpenAIModel, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});

const handbook = [
  '# Acme Cloud -- Support Handbook',
  '',
  '## Billing',
  '- Plan downgrades take effect at the END of the current billing cycle, not immediately.',
  '- Refunds are issued to the original payment method within 5 business days.',
  '',
  '## Data',
  '- Deleted workspaces are recoverable for 30 days, then permanently purged.',
].join('\n');

// The handbook stays in the agent's runtime, out of the prompt. With citations
// on, the answer cites the evidence it used, and ids the run never gathered are
// sent back to the model for a correction.
const assistant = agent('question:string, handbook:string -> answer:string', {
  contextFields: ['handbook'],
  citations: { onCitations: (ids) => console.log('\ncited:', ids) },
  maxTurns: 12,
});

// The distiller and the executor run first; then the responder's answer
// streams. Merge each delta and start over when the version changes (a retry).
let version = 0;
for await (const chunk of assistant.streamingForward(llm, {
  question:
    'I downgraded today. When does it take effect, and is my data safe if I delete the workspace?',
  handbook,
})) {
  if (chunk.version !== version) {
    version = chunk.version;
    console.log('\n[retry: starting over]');
  }
  if (chunk.delta.answer) process.stdout.write(chunk.delta.answer);
}
console.log();
