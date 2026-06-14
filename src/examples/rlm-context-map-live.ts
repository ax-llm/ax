/**
 * RLM Context Map — Live Provider Run
 *
 * Reuses a small persisted orientation map across repeated questions over the
 * same long context. The first run can evolve the map; later runs receive that
 * map as compact context instead of rediscovering the corpus structure.
 *
 * Prerequisite: OPENAI_APIKEY
 *
 * Run: npm run tsx src/examples/rlm-context-map-live.ts
 */

import {
  AxAgentContextMap,
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
  ai,
} from '@ax-llm/ax';

// docs:start context-map
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
    temperature: 0,
  },
});

const corpus = [
  'Incident corpus: checkout reliability, Q2.',
  'Records are newline-delimited JSON.',
  'incident records use incident_id, severity, tenant_tier, and service_id.',
  'service records use service_id, owner, and deploy_channel.',
  'mitigation records use incident_id, action, started_at, and recovered_at.',
  'metric records use service_id, name, p95_ms, and window.',
  'Enterprise checkout incidents repeatedly reference service_id svc-checkout-edge.',
].join('\n');

const map = new AxAgentContextMap(undefined, {
  maxChars: 1_600,
  infiniteEvolve: false,
  evolveSteps: 1,
});

const analyzer = agent(
  'context:string, query:string -> answer:string, fields:string[] "Relevant fields used to answer"',
  {
    contextFields: ['context'],
    runtime: new AxJSRuntime(),
    contextPolicy: {
      preset: 'lean',
      budget: 'compact',
    },
    contextCache: { ttlSeconds: 3600 },
    contextMap: {
      map,
      onUpdate: ({ map: updatedMap }) => {
        console.log('Context map updated:');
        console.log(updatedMap.text);
      },
    },
    maxTurns: 12,
  }
);

for (const query of [
  'Which fields connect incidents to services?',
  'Which fields should I inspect for enterprise checkout incidents?',
]) {
  const result = await analyzer.forward(llm, { context: corpus, query });
  console.log('\nQuery:', query);
  console.log('Answer:', result.answer);
  console.log('Fields:', result.fields.join(', '));
}

console.log('\nPersist this context-map snapshot between runs:');
console.log(JSON.stringify(map.snapshot(), null, 2));
// docs:end context-map
