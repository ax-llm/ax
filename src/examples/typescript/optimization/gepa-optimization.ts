// ax-example:start
// title: TypeScript GEPA Optimization
// group: optimization
// description: Reports held-out baseline and optimized scores from the same GEPA run.
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
    model: AxAIOpenAIModel.GPT56Luna,
    temperature: 0,
  },
});

const program = ax(
  'emailText:string -> priority:class "high, normal, low", rationale:string'
);

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

const validation = [
  {
    emailText: 'Production payments are failing for all customers.',
    priority: 'high',
  },
  {
    emailText: 'Optional reading: our monthly company newsletter.',
    priority: 'low',
  },
  {
    emailText: 'Please submit your expense report by Friday.',
    priority: 'normal',
  },
];

const result = await optimize(program, train, metric, {
  studentAI: llm,
  teacherAI: llm,
  numTrials: 1,
  validationExamples: validation,
  maxMetricCalls: 20,
});

if (!result.optimizedProgram) {
  throw new Error('Optimizer did not return an optimized program.');
}

program.applyOptimization(result.optimizedProgram);
console.log(
  JSON.stringify(
    {
      baseline: result.baselineScore,
      optimized: result.bestScore,
      delta:
        result.baselineScore === undefined
          ? undefined
          : result.bestScore - result.baselineScore,
    },
    null,
    2
  )
);
