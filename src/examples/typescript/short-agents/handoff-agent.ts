// ax-example:start
// title: TypeScript Specialist Planner Agent
// group: short-agents
// description: A specialist that plans a migration from a long brief held in contextFields, using a checkpointed contextPolicy and a runtime-output cap to stay compact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import { AxAIOpenAIModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

// A long, messy brief — exactly the kind of input you do not want replayed into
// the prompt on every turn. `contextFields` holds it in the runtime, the
// `checkpointed` policy compacts older turns once the prompt grows, and
// `maxRuntimeChars` caps how much runtime output is echoed back.
const brief = `
# Migration brief: monolith -> services (draft, unordered notes)

Current: single Rails monolith, Postgres primary + 1 replica, Sidekiq for jobs.
Pain: deploys take 40m, one bad migration locks the orders table, on-call burnout.
Constraints: no downtime windows > 5m, PCI scope must shrink, team of 6, 2 quarters.
Hot paths: checkout (writes orders, payments), search (read-heavy), notifications (async).
Known landmines: payments code has no tests; search shares the orders DB; a nightly
cron rebuilds the catalog and pins CPU for ~20m; the replica lags up to 90s under load.
Org wants: independent deploys for checkout, smaller blast radius, an audit trail.
Nice to have: event log for orders, read-model for search, feature flags.
Hard no: a big-bang rewrite; introducing Kubernetes this year.
`.trim();

const specialist = agent(
  'brief:string, goal:string -> plan:string[] "Ordered, concrete steps", answer:string, risks:string[]',
  {
    runtime: new AxJSRuntime(),
    contextFields: ['brief'],
    contextPolicy: {
      preset: 'checkpointed',
      budget: 'balanced',
    },
    maxRuntimeChars: 3000,
    maxTurns: 12,
  }
);

const result = await specialist.forward(llm, {
  brief,
  goal: 'Propose a safe, incremental 2-quarter plan to split checkout out first, respecting the hard constraints.',
});

console.log(JSON.stringify(result, null, 2));
