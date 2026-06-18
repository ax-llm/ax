// ax-example:start
// title: TypeScript Multi-Model Panel
// group: short-agents
// description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
// level: advanced
// order: 40
// ax-example:end
import {
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  ai,
  ax,
} from '@ax-llm/ax';

const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
const googleKey = process.env.GOOGLE_APIKEY ?? process.env.GOOGLE_API_KEY;
const anthropicKey =
  process.env.ANTHROPIC_APIKEY ?? process.env.ANTHROPIC_API_KEY;
if (!openaiKey || !googleKey || !anthropicKey) {
  throw new Error(
    'Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.'
  );
}

// A panel of three different providers, each answering the same question
// independently. This is plain `ax()` composition (no agent runtime) — fan out
// to the panel, judge the candidates, then synthesize one grounded answer.
const panel = [
  {
    model: 'openai/gpt-4o-mini',
    llm: ai({
      name: 'openai',
      apiKey: openaiKey,
      config: { model: AxAIOpenAIModel.GPT4OMini, temperature: 0 },
    }),
  },
  {
    model: 'google/gemini-3-flash',
    llm: ai({
      name: 'google-gemini',
      apiKey: googleKey,
      config: { model: AxAIGoogleGeminiModel.Gemini3Flash },
    }),
  },
  {
    model: 'anthropic/claude-haiku-4.5',
    llm: ai({
      name: 'anthropic',
      apiKey: anthropicKey,
      config: { model: AxAIAnthropicModel.Claude45Haiku },
    }),
  },
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

async function fusion(question: string) {
  // Each panelist is a different provider answering independently.
  const candidates = await Promise.all(
    panel.map(async ({ model, llm }) => ({
      model,
      ...(await researcher.forward(llm, { question })),
    }))
  );
  // The judge + synthesizer run on one of the panel clients (OpenAI here).
  const orchestrator = panel[0].llm;
  const review = await judge.forward(orchestrator, { question, candidates });
  return synthesizer.forward(orchestrator, { question, candidates, review });
}

const final = await fusion(
  'What are the strongest arguments for and against a national carbon tax?'
);

console.log(JSON.stringify(final, null, 2));
