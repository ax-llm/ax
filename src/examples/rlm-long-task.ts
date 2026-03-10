/**
 * RLM Long Task — Context Policy With Checkpoint Summaries
 *
 * Demonstrates `contextPolicy` for a multi-step analysis that produces errors
 * along the way. Checkpoint summaries keep older successful turns compact while
 * runtime state and unresolved issues stay visible to the actor.
 */

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
    model: AxAIGoogleGeminiModel.Gemini3Flash,
  },
});

const analyzer = agent(
  'context:string, query:string -> answer:string, keyFindings:string[] "Analyzes a large dataset using a code interpreter, tolerates intermediate errors, and keeps context lean via checkpoint-style context policy"',
  {
    contextFields: ['context'],
    runtime: new AxJSRuntime({
      permissions: [AxJSRuntimePermission.TIMING],
    }),
    maxTurns: 20,
    maxSubAgentCalls: 40,
    mode: 'simple',

    contextPolicy: {
      preset: 'lean',
      state: {
        summary: true,
        inspect: true,
        inspectThresholdChars: 3_000,
        maxEntries: 6,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 3_000,
      },
      expert: {
        pruneErrors: true,
        rankPruning: { enabled: true, minRank: 2 },
        tombstones: {
          model: AxAIGoogleGeminiModel.Gemini3Flash,
          modelConfig: { maxTokens: 60 },
        },
      },
    },

    debug: true,
  }
);

// ---------------------------------------------------------------------------
// Synthetic dataset — large enough to exercise multi-turn analysis but small
// enough to run without real file I/O.
// ---------------------------------------------------------------------------

const salesData = `
Region,Month,Product,Units,Revenue,ReturnRate
North,Jan,Widget-A,1200,48000,0.02
North,Jan,Widget-B,800,32000,0.05
North,Feb,Widget-A,1350,54000,0.018
North,Feb,Widget-B,720,28800,0.06
North,Mar,Widget-A,900,36000,0.03
North,Mar,Widget-B,1100,44000,0.04
South,Jan,Widget-A,980,39200,0.025
South,Jan,Widget-B,1500,60000,0.03
South,Feb,Widget-A,1100,44000,0.02
South,Feb,Widget-B,1300,52000,0.035
South,Mar,Widget-A,760,30400,0.045
South,Mar,Widget-B,1450,58000,0.025
East,Jan,Widget-A,2100,84000,0.015
East,Jan,Widget-B,600,24000,0.07
East,Feb,Widget-A,1950,78000,0.018
East,Feb,Widget-B,650,26000,0.065
East,Mar,Widget-A,2300,92000,0.012
East,Mar,Widget-B,700,28000,0.06
West,Jan,Widget-A,1700,68000,0.022
West,Jan,Widget-B,900,36000,0.04
West,Feb,Widget-A,1600,64000,0.025
West,Feb,Widget-B,950,38000,0.038
West,Mar,Widget-A,1800,72000,0.02
West,Mar,Widget-B,1000,40000,0.035
`.trim();

const result = await analyzer.forward(llm, {
  context: salesData,
  query:
    'Which region and product combination has the highest revenue growth from Jan to Mar? ' +
    'Also flag any combinations where the return rate is worsening month-over-month.',
});

console.log('\n=== Answer ===');
console.log(result.answer);
console.log('\n=== Key Findings ===');
for (const finding of result.keyFindings) {
  console.log(' •', finding);
}
