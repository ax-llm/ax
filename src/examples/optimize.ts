import { AxAIOpenAIModel, ai, ax, optimize } from '@ax-llm/ax';

const program = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low" "Priority"'
);

const train = [
  { emailText: 'URGENT: Server down!', priority: 'high' },
  { emailText: 'Weekly newsletter', priority: 'low' },
  { emailText: 'Meeting reminder for tomorrow', priority: 'normal' },
  { emailText: 'CRITICAL: Security breach', priority: 'high' },
];

const validationExamples = [
  { emailText: 'Production checkout is failing', priority: 'high' },
  { emailText: 'Lunch plans?', priority: 'low' },
  { emailText: 'Please submit timesheets', priority: 'normal' },
];

const studentAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

const teacherAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4O },
});

const metric = ({ prediction, example }: { prediction: any; example: any }) =>
  prediction.priority === example.priority ? 1 : 0;

const result = await optimize(program, train, metric, {
  studentAI,
  teacherAI,
  validationExamples,
  numTrials: 6,
  maxMetricCalls: 40,
});

program.applyOptimization(result.optimizedProgram!);

console.log({
  bestScore: result.bestScore,
  demoGroups: result.optimizedProgram?.demos?.length ?? 0,
  optimizedComponents: Object.keys(result.optimizedProgram?.componentMap ?? {}),
});
