/**
 * Context-compression baseline spike (LIVE — real model, real tokens).
 *
 * The live sibling of `context-compression-spike.ts`. Runs one realistic
 * long-horizon incident-analysis task (mirrors `rlm-context-management-live.ts`)
 * under each shipped `contextPolicy` preset against a real Gemini model, and
 * reports the real token cost, peak prompt size, compaction, and answer
 * correctness per preset. This is the real (hindsight) baseline a future
 * plan-aware foresight strategy must beat.
 *
 * Unlike the offline spike this is non-deterministic and costs API calls; it
 * records per-preset correctness rather than asserting a single PASS.
 *
 * Run: `GOOGLE_APIKEY=… npx tsx src/examples/context-compression-live.ts`
 */
import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';
import {
  AxContextMetricsCollector,
  type AxContextMetricsRow,
  renderMetricsTable,
} from '../ax/agent/benchmarks/contextMetrics.js';

const googleApiKey = process.env.GOOGLE_APIKEY;
if (!googleApiKey) {
  throw new Error('GOOGLE_APIKEY is required for the live context spike');
}

// Override with AX_LIVE_MODEL to compare model tiers (e.g. gemini-3.1-pro-preview).
const model = (process.env.AX_LIVE_MODEL ??
  AxAIGoogleGeminiModel.Gemini35Flash) as AxAIGoogleGeminiModel;

const llm = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: { model },
});

const incidentNotes = `
[09:00] Alert: Checkout latency exceeded 2.5s in us-west.
[09:02] Metrics: p95 latency rose from 640ms to 2.8s after deploy web-2026.03.01.1.
[09:03] Metrics: CPU on checkout-api stayed flat, but cache miss rate doubled from 14% to 31%.
[09:05] Logs: pricing_rules cache lookup miss for tenant enterprise-17 repeated 1,842 times in 5 minutes.
[09:08] Deploy note: pricing_rules_v2 hydration enabled for enterprise tenants only.
[09:12] Failed attempt: reading the verbose trace timed out and should not be repeated.
[09:18] Rollback: feature flag pricing_rules_v2 disabled for enterprise tenants.
[09:20] Metrics: cache miss rate fell to 16% and latency recovered to 820ms within 4 minutes.
[09:24] Follow-up: no evidence of payment failures; impact was delayed price calculation before order submit.
`.trim();

const incidentTools = [
  fn('fetchIncidentFacts')
    .namespace('ops')
    .description(
      'Fetch compact curated incident facts. Use includeVerboseTrace=false under context pressure.'
    )
    .arg('incidentId', f.string('Incident id such as checkout-17'))
    .arg(
      'includeVerboseTrace',
      f.boolean('Whether to include the verbose trace').optional()
    )
    .returns(f.string('Curated incident fact').array())
    .handler(async ({ incidentId, includeVerboseTrace = false }) => {
      if (incidentId !== 'checkout-17') {
        return [];
      }
      if (includeVerboseTrace) {
        throw new Error(
          'Verbose trace timed out previously; retry compact facts instead'
        );
      }
      return [
        'cache miss rate doubled from 14% to 31% for enterprise tenants',
        'pricing_rules_v2 hydration introduced a tenant-scoped cache key regression',
        'rollback disabled pricing_rules_v2 and recovered p95 latency to 820ms',
        'customer impact was delayed price calculation before order submit',
      ];
    })
    .build(),
];

const query = [
  'Evaluate AxAgent context management on this incident.',
  'Work in multiple compact turns: first call ops.fetchIncidentFacts with includeVerboseTrace:false, then create rootCause, impactNote, and nextStep runtime variables, then final.',
  'Do not log the full incidentNotes or retry verbose trace reading.',
  'Use exact final format: Root cause / Impact / Next step.',
  'padding '.repeat(9_000),
].join('\n');

const PRESETS = ['full', 'checkpointed', 'adaptive', 'lean'] as const;

const scoreAnswer = (
  answer: string,
  keyFindings: readonly string[]
): boolean => {
  const text = [answer, ...keyFindings].join('\n').toLowerCase();
  return (
    /pricing_rules_v2|cache key|cache/.test(text) &&
    /impact|delayed price|latency/.test(text) &&
    /next step|patch|rollback|disable|warming|verify/.test(text)
  );
};

const rows: AxContextMetricsRow[] = [];
const outcomes: Array<{ preset: string; status: 'pass' | 'review' | 'error' }> =
  [];

for (const preset of PRESETS) {
  const collector = new AxContextMetricsCollector();
  const analyzer = agent(
    'incidentNotes:string, incidentId:string, query:string -> answer:string, keyFindings:string[]',
    {
      ai: llm,
      contextFields: ['incidentNotes'],
      runtime: new AxJSRuntime({ permissions: [AxJSRuntimePermission.TIMING] }),
      functions: incidentTools,
      maxTurns: 8,
      contextPolicy: { preset, budget: 'compact' },
      onContextEvent: collector.onEvent,
    }
  );

  const startedAt = Date.now();
  try {
    const result = await analyzer.forward(llm, {
      incidentNotes,
      incidentId: 'checkout-17',
      query,
    });
    rows.push({
      scenario: 'incident',
      preset,
      summary: collector.summarize(analyzer.getUsage()),
      elapsedMs: Date.now() - startedAt,
    });
    outcomes.push({
      preset,
      status: scoreAnswer(result.answer ?? '', result.keyFindings ?? [])
        ? 'pass'
        : 'review',
    });
  } catch (err) {
    // Live models are non-deterministic (empty turns, hallucinated tools);
    // record the failure as a robustness signal and keep the sweep going.
    rows.push({
      scenario: 'incident',
      preset,
      summary: collector.summarize(analyzer.getUsage()),
      elapsedMs: Date.now() - startedAt,
    });
    outcomes.push({ preset, status: 'error' });
    const message =
      err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`  [${preset}] run errored: ${message}`);
  }
}

console.log(`AxAgent context-compression baseline (LIVE, ${model})\n`);
console.log(renderMetricsTable(rows));

console.log(
  '\nOutcome per preset (pass = correct, review = incomplete, error = run failed):'
);
for (const { preset, status } of outcomes) {
  console.log(`  ${preset.padEnd(12)} ${status}`);
}

console.log(
  '\nCorrectness is the gate. Among correct presets it is a tokens <-> speed (ms) tradeoff.'
);
console.log(
  'mgmtCalls = extra context-management LLM round-trips (checkpoints + tombstones)'
);
console.log(
  'that trade latency for fewer tokens. Single run per preset; run several times for stable medians.'
);

console.log('\nLive baseline captured.');
