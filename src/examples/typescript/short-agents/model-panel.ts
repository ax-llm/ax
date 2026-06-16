// ax-example:start
// title: TypeScript Multi-Model Panel
// group: short-agents
// description: Fans one question across several models via OpenRouter, then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENROUTER_API_KEY
// level: advanced
// order: 40
// ax-example:end
import { type AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error('Set OPENROUTER_API_KEY to run this example.');
}

// One OpenRouter client; each call selects a different model with a per-call
// override. This is plain `ax()` composition — no agent runtime needed — but it
// shows how to build a research panel that disagrees, gets judged, and is
// synthesized into one answer.
const llm = ai({
  name: 'openai',
  apiKey,
  apiURL: 'https://openrouter.ai/api/v1',
  config: { model: 'openai/gpt-4o-mini' as AxAIOpenAIModel },
});

const panelModels = [
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-haiku',
];

const researcher = ax(
  'question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number'
);
researcher.setInstruction(
  'Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus.'
);

const judge = ax(
  'question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]'
);
judge.setInstruction(
  'Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points.'
);

const synthesizer = ax(
  'question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]'
);
synthesizer.setInstruction(
  'Write one final answer grounded in the candidates and review. Resolve conflicts explicitly.'
);

async function askPanelist(model: string, question: string) {
  const response = await researcher.forward(llm, { question }, { model });
  return { model, ...response };
}

async function fusion(question: string) {
  const candidates = await Promise.all(
    panelModels.map((model) => askPanelist(model, question))
  );
  const review = await judge.forward(llm, { question, candidates });
  return synthesizer.forward(llm, { question, candidates, review });
}

const final = await fusion(
  'What are the strongest arguments for and against a national carbon tax?'
);

console.log(JSON.stringify(final, null, 2));
