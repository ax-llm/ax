import {
  type AxAgentContextEvent,
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const googleApiKey = process.env.GOOGLE_APIKEY;
if (!googleApiKey) {
  throw new Error('GOOGLE_APIKEY is required for the live context eval');
}

const llm = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35Flash,
  },
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

const contextEvents: AxAgentContextEvent[] = [];
const actorTurns: Array<{
  turn: number;
  stage: string;
  code: string;
  output: string;
  isError: boolean;
  chatLogText: string;
}> = [];
const functionCalls: string[] = [];

const analyzer = agent(
  'incidentNotes:string, incidentId:string, query:string -> answer:string, keyFindings:string[]',
  {
    ai: llm,
    contextFields: ['incidentNotes'],
    runtime: new AxJSRuntime({
      permissions: [AxJSRuntimePermission.TIMING],
    }),
    functions: incidentTools,
    maxTurns: 8,
    contextPolicy: {
      preset: 'checkpointed',
      budget: 'compact',
    },
    actorTurnCallback: (turn) => {
      actorTurns.push({
        turn: turn.turn,
        stage: turn.stage,
        code: turn.code,
        output: turn.output,
        isError: turn.isError,
        chatLogText:
          turn.chatLogMessages
            ?.map((message) => `${message.role}: ${message.content}`)
            .join('\n') ?? '',
      });
    },
    onContextEvent: (event) => {
      contextEvents.push(event);
    },
    onFunctionCall: (call) => {
      functionCalls.push(call.qualifiedName);
    },
  }
);

const result = await analyzer.forward(llm, {
  incidentNotes,
  incidentId: 'checkout-17',
  query: [
    'Evaluate AxAgent context management on this incident.',
    'Work in multiple compact turns: first call ops.fetchIncidentFacts with includeVerboseTrace:false, then create rootCause, impactNote, and nextStep runtime variables, then final.',
    'Do not log the full incidentNotes or retry verbose trace reading.',
    'Use exact final format: Root cause / Impact / Next step.',
    'padding '.repeat(9_000),
  ].join('\n'),
});

console.log('Final answer:');
console.log(result.answer);
console.log('\nKey findings:');
for (const finding of result.keyFindings ?? []) {
  console.log(`- ${finding}`);
}

console.log('\nContext events:');
for (const event of contextEvents) {
  if (event.kind === 'budget_check') {
    console.log(
      `- ${event.stage} turn ${event.turn}: ${event.pressure}, checkpoint=${event.checkpointActive}`
    );
  } else {
    console.log(`- ${event.stage} turn ${event.turn}: ${event.kind}`);
  }
}

console.log('\nActor turns:');
for (const turn of actorTurns) {
  console.log(
    `- ${turn.stage} turn ${turn.turn}: error=${turn.isError}, code=${turn.code.slice(0, 160)}`
  );
}

const assertScore = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(`Live scorecard failed: ${message}`);
  }
};

const combinedAnswer = [result.answer, ...(result.keyFindings ?? [])]
  .join('\n')
  .toLowerCase();
const combinedCode = actorTurns.map((turn) => turn.code).join('\n');
const combinedChat = actorTurns.map((turn) => turn.chatLogText).join('\n');
const checkpointCreated = contextEvents.some(
  (event) => event.kind === 'checkpoint_created'
);
const verboseTraceErrors = actorTurns.filter((turn) =>
  /verbose trace|timed out/i.test(turn.output)
);

assertScore(
  /pricing_rules_v2|cache key|cache/.test(combinedAnswer),
  'answer mentions the likely cache-key root cause'
);
assertScore(
  /impact|delayed price|latency/.test(combinedAnswer),
  'answer mentions customer impact'
);
assertScore(
  /next step|patch|rollback|disable|warming|verify/.test(combinedAnswer),
  'answer includes a next step'
);
assertScore(checkpointCreated, 'checkpoint event fires under pressure');
assertScore(
  functionCalls.includes('ops.fetchIncidentFacts'),
  'model uses the compact incident facts callable'
);
assertScore(
  !/console\.log\(\s*incidentNotes\s*\)/.test(combinedCode),
  'model avoids logging the full raw incident notes'
);
assertScore(
  verboseTraceErrors.length <= 1,
  'model does not repeatedly retry the verbose trace failure'
);
assertScore(
  combinedChat.includes('ops.fetchIncidentFacts'),
  'callable name survives into actor prompt/checkpoint context'
);

console.log('\nLive scorecard: PASS');
