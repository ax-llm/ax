// ax-example:start
// title: TypeScript GEPA Optimization
// group: optimization
// description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import { AxAIOpenAIModel, ai, ax, optimize } from '@ax-llm/ax';

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

const program = ax(
  'emailText:string -> priority:class "high, normal, low", rationale:string'
);

const baseline = await program.forward(llm, {
  emailText: 'Production checkout is failing for enterprise customers.',
});

const train = [
  {
    emailText: 'URGENT: checkout is down',
    priority: 'high',
    rationale: 'Production checkout outage blocks customers.',
  },
  {
    emailText: 'Weekly newsletter',
    priority: 'low',
    rationale: 'Informational update with no action needed.',
  },
  {
    emailText: 'Reminder to submit timesheets',
    priority: 'normal',
    rationale: 'Routine request with a clear deadline.',
  },
];

const metric = ({ prediction, example }: { prediction: any; example: any }) =>
  prediction.priority === example.priority ? 1 : 0;

const result = await optimize(program, train, metric, {
  studentAI: llm,
  teacherAI: llm,
  numTrials: 1,
  maxMetricCalls: 4,
});

if (!result.optimizedProgram) {
  throw new Error('Optimizer did not return an optimized program.');
}

program.applyOptimization(result.optimizedProgram);
console.log(JSON.stringify({ baseline, bestScore: result.bestScore }, null, 2));
