// ax-example:start
// title: TypeScript Smart Defaults Agent
// group: long-agents
// description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 60
// ax-example:end
import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) {
  throw new Error('Set GOOGLE_APIKEY to run this example.');
}

const TIMELINE = [
  '09:12 checkout-edge v812 deployed behind 25% of traffic',
  '09:18 payments gateway p95 rose from 420ms to 4.8s',
  '09:22 cart completion dropped 31% for enterprise accounts',
  '09:27 retries saturated the checkout-edge connection pool',
  '09:31 rollback to v811 started',
  '09:36 p95 returned below 700ms after pool reset',
];

const incidentLog = Array.from(
  { length: 28 },
  (_, i) => `# log shard ${i + 1}\n${TIMELINE.join('\n')}`
).join('\n\n');

const incidentSummary = {
  service: 'checkout',
  severity: 'sev-1',
  rootCause:
    'checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool.',
  errorRate: '38%',
  affectedSessions: 1284,
  candidateRunbook: 'payments-timeout-runbook',
  relevantMemory: 'decision-enterprise-comms',
};

const summarizeIncident = fn('summarizeIncident')
  .namespace('incident')
  .description(
    'Summarize the current checkout incident and name the strongest runbook and memory matches.'
  )
  .arg('service', f.string('Service name, for example checkout.'))
  .returns(f.json('Structured incident summary.'))
  .handler(({ service }) => ({ ...incidentSummary, service }))
  .build();

const getTimeline = fn('getTimeline')
  .namespace('incident')
  .description(
    'Return concrete timestamped evidence for the checkout incident.'
  )
  .arg('service', f.string('Service name, for example checkout.'))
  .returns(f.json('Timestamped incident timeline.'))
  .handler(({ service }) => TIMELINE.map((event) => ({ service, event })))
  .build();

const getRunbook = fn('getRunbook')
  .namespace('incident')
  .description(
    'Fetch the operational runbook steps for a relevant incident pattern.'
  )
  .arg('id', f.string('Runbook id.'))
  .returns(f.json('Runbook steps.'))
  .handler(({ id }) => ({
    id,
    steps: [
      'Freeze checkout deploys and page the payments owner.',
      'Rollback checkout-edge to v811 and reset saturated pools.',
      'Post enterprise status update after error rate stays below 2%.',
    ],
  }))
  .build();

const analyst = agent(
  'incidentLog:string, question:string -> rootCause:string, actions:string[] "Recommended remediation actions from the runbook", evidence:string[]',
  {
    name: 'SmartDefaultsIncidentAgent',
    description:
      'Investigate checkout incidents. Use runtime tools for facts, relevance hints for runbooks and memories, and avoid copying raw logs.',
    functions: [summarizeIncident, getTimeline, getRunbook],
    runtime: new AxJSRuntime(),
    skillsCatalog: [
      {
        id: 'payments-timeout-runbook',
        name: 'Payments timeout runbook',
        content:
          'Use when checkout latency follows payment gateway retry amplification.',
      },
      {
        id: 'status-comms-runbook',
        name: 'Status communications',
        content:
          'Use when customer-facing enterprise account updates are required.',
      },
    ],
    memoriesCatalog: [
      {
        id: 'decision-enterprise-comms',
        content:
          'For sev-1 checkout incidents, send an enterprise status update only after rollback is complete and error rate is below 2%.',
      },
      {
        id: 'checkout-v812-rollback',
        content:
          'checkout-edge v812 rollback completed cleanly once saturated payment pools were reset.',
      },
    ],
    executorOptions: {
      description:
        'Call incident.summarizeIncident, incident.getTimeline, and incident.getRunbook before answering. The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt. Return the first three remediation actions, not historical timeline events.',
    },
  }
);

const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
});

const result = await analyst.forward(
  llm,
  {
    incidentLog,
    question:
      'Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident.',
  },
  { maxTurns: 30 }
);

console.log(JSON.stringify(result, null, 2));
