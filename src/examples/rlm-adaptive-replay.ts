import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3FlashLite,
  },
});

const incidentAnalyst = agent(
  'incidentLog:string, question:string -> answer:string, findings:string[] "Analyzes a long incident log with adaptive replay so older successful turns collapse into checkpoint summaries while live runtime state stays available"',
  {
    contextFields: [
      {
        field: 'incidentLog',
        keepInPromptChars: 600,
        reverseTruncate: true,
      },
    ],
    runtime: new AxJSRuntime({
      permissions: [AxJSRuntimePermission.TIMING],
    }),
    maxTurns: 10,
    maxSubAgentCalls: 20,
    mode: 'simple',
    contextPolicy: {
      preset: 'adaptive',
      state: {
        summary: true,
        inspect: true,
        inspectThresholdChars: 2_000,
        maxEntries: 6,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 2_000,
      },
      expert: {
        pruneErrors: true,
        rankPruning: { enabled: true, minRank: 2 },
      },
    },
    actorOptions: {
      thinkingTokenBudget: 'minimal',
    },
    debug: true,
  }
);

const incidentLog = `
[2026-03-01 09:00] Alert: Checkout latency exceeded 2.5s in us-west.
[2026-03-01 09:02] Metrics: p95 latency rose from 640ms to 2.8s after deploy web-2026.03.01.1.
[2026-03-01 09:03] Metrics: CPU on checkout-api stayed flat, but cache miss rate doubled from 14% to 31%.
[2026-03-01 09:05] Logs: "pricing_rules cache lookup miss for tenant enterprise-17" repeated 1,842 times in 5 minutes.
[2026-03-01 09:08] Deploy note: new pricing-rule hydration path was enabled for enterprise tenants only.
[2026-03-01 09:11] Metrics: database read IOPS increased 3.1x on primary catalog cluster.
[2026-03-01 09:14] Support: enterprise-17 reported duplicate loading spinners and delayed checkout totals.
[2026-03-01 09:18] Rollback: feature flag pricing_rules_v2 disabled for enterprise tenants.
[2026-03-01 09:20] Metrics: cache miss rate fell to 16% and latency recovered to 820ms within 4 minutes.
[2026-03-01 09:24] Follow-up: no evidence of payment failures; impact was delayed price calculation before order submit.
[2026-03-01 09:31] Action item: decide whether to patch cache warming or keep the feature off until next release.
[2026-03-01 09:40] Postmortem draft: likely regression in tenant-scoped cache key generation during pricing_rules_v2 hydration.
`.trim();

const result = await incidentAnalyst.forward(llm, {
  incidentLog,
  question:
    'What is the most likely root cause, what customer impact is confirmed, and what should the team do next?',
});

console.log('Answer:', result.answer);
console.log('Findings:');
for (const finding of result.findings) {
  console.log('-', finding);
}
