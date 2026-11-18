// ax-example:start
// title: Reacting to New Tool Evidence
// group: short-agents
// description: Checks that a Gemini Flash-Lite agent reads discovered tool rules and a new advisory before choosing a route, while deterministic tools remain batchable.
// provider: google-gemini
// env: GOOGLE_APIKEY, GEMINI_API_KEY, GOOGLE_API_KEY
// level: intermediate
// order: 25
// ax-example:end
import { AxAIGoogleGeminiModel, agent, ai, f, fn } from '@ax-llm/ax';

const apiKey =
  process.env.GOOGLE_APIKEY ??
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY;
if (!apiKey)
  throw new Error('Set GOOGLE_APIKEY, GEMINI_API_KEY, or GOOGLE_API_KEY.');
const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35FlashLite,
  },
});

// All tool effects in this example stay in memory. The advisory varies between
// runs and is absent from the task, so a hard-coded first plan cannot pass both.
for (const available of ['backup', 'primary', 'backup'] as const) {
  const observations: string[] = [];
  const decisions: string[] = [];
  let attempts = 0;
  let reads = 0;
  const lookup = fn('advisory')
    .namespace('routing')
    .description(
      'Read the current route advisory before recording any decision.'
    )
    .returns(f.string())
    .handler(() => {
      reads++;
      return available === 'backup'
        ? 'Primary is closed for maintenance. Backup remains open.'
        : 'Backup is closed for maintenance. Primary remains open.';
    })
    .build();
  const record = fn('record')
    .namespace('routing')
    .description(
      'Record the available route. Required audit label: reviewed-current-advisory.'
    )
    .arg('route', f.class(['primary', 'backup']))
    .arg('auditLabel', f.string())
    .returns(f.string())
    .resultPolicy('data')
    .handler(({ route, auditLabel }) => {
      attempts++;
      if (
        !observations.some((output) =>
          output.includes('closed for maintenance')
        )
      ) {
        throw new Error(
          'Decision attempted before the advisory reached a model turn.'
        );
      }
      if (route !== available || auditLabel !== 'reviewed-current-advisory') {
        throw new Error(`Incorrect decision: ${route}, ${auditLabel}`);
      }
      decisions.push(route);
      return `Recorded ${route}`;
    })
    .build();
  const router = agent('task:string -> answer:string', {
    functions: [lookup, record],
    functionDiscovery: true,
    directResponse: 'off',
    contextFields: [],
    maxTurns: 10,
    contextPolicy: { preset: 'full' },
    actorTurnCallback: ({ stage, turn, code, output }) => {
      if (process.env.AX_OBSERVATION_TRACE === '1')
        console.log(JSON.stringify({ stage, turn, code, output }));
      if (stage === 'executor') observations.push(output);
    },
  });
  await router.forward(llm, {
    task: 'Read the current advisory and record the available route. Prefer primary when it is open. Use the tool documentation for the audit requirements.',
  });
  if (
    reads !== 1 ||
    attempts !== 1 ||
    decisions.length !== 1 ||
    decisions[0] !== available
  ) {
    throw new Error(
      `Expected one read and one correct attempt; got ${reads} reads, ${attempts} attempts, ${JSON.stringify(decisions)}.`
    );
  }
  console.log(
    JSON.stringify({
      model: AxAIGoogleGeminiModel.Gemini35FlashLite,
      available,
      reads,
      attempts,
      decisions,
      executorTurns: observations.length,
      passed: true,
    })
  );
}
