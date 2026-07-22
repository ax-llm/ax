// ax-example:start
// title: TypeScript Adaptive Provider Balancing
// group: generation
// description: Learns provider reliability and latency, then balances one logical model alias against cost and a deadline.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: advanced
// order: 50
// ax-example:end
import {
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  AxBalancer,
  AxInMemoryBalancerStatsStore,
  ai,
  ax,
} from '@ax-llm/ax';

const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
const anthropicKey =
  process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_APIKEY;
if (!openaiKey || !anthropicKey) {
  throw new Error(
    'Set OPENAI_API_KEY (or OPENAI_APIKEY) and ANTHROPIC_API_KEY (or ANTHROPIC_APIKEY).'
  );
}

const openai = ai({
  name: 'openai',
  apiKey: openaiKey,
  models: [
    {
      key: 'fast',
      model: AxAIOpenAIModel.GPT54Mini,
      description: 'Fast general-purpose model',
    },
  ],
});

const anthropic = ai({
  name: 'anthropic',
  apiKey: anthropicKey,
  models: [
    {
      key: 'fast',
      model: AxAIAnthropicModel.Claude45Haiku,
      description: 'Fast general-purpose model',
    },
  ],
});

// Reuse this store across balancers in one process. For multiple processes,
// provide an AxBalancerStatsStore backed by Redis or your application database.
const statsStore = new AxInMemoryBalancerStatsStore();
const routeKeys = new Map<string, string>([
  [openai.getId(), 'openai-primary'],
  [anthropic.getId(), 'anthropic-primary'],
]);

const llm = AxBalancer.create([openai, anthropic] as const, {
  strategy: {
    type: 'adaptive',
    deadlineMs: 6_000,
    badOutcomeCost: 0.02,
    expectedTokens: { promptTokens: 1_200, completionTokens: 300 },
    namespace: 'support-summary-v1',
    routeKey: (service) => {
      const key = routeKeys.get(service.getId());
      if (!key) throw new Error('Missing stable route key.');
      return key;
    },
    slice: ({ options }) =>
      options?.customLabels?.workflow ?? 'default-workflow',
    statsStore,
    // Analytics only: statsStore remains the authoritative decision state.
    onRoutingEvent: (event) => {
      if (event.type === 'selected' || event.type === 'fallback') {
        console.log('route:', event);
      }
    },
  },
});

const summarize = ax('supportTicket:string -> summary:string, urgency:string');
const result = await summarize.forward(
  llm,
  {
    supportTicket:
      'Our checkout started timing out after the latest deployment.',
  },
  {
    model: 'fast',
    customLabels: { workflow: 'support-summary' },
  }
);

console.log(result);
