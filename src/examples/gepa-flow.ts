import { AxAI, AxAIOpenAIModel, AxGEPAFlow, flow } from '@ax-llm/ax';

// Two-objective flow: classify priority and produce a brief rationale
const flowEmail = flow<{ emailText: string }>()
  .description(
    'Email Priority Classifier',
    'Classifies an email priority and produces a concise rationale.'
  )
  .n('classifier', 'emailText:string -> priority:class "high, normal, low"')
  .n(
    'rationale',
    'emailText:string, priority:string -> rationale:string "One concise sentence"'
  )
  .e('classifier', (s) => ({ emailText: s.emailText }))
  .e('rationale', (s) => ({
    emailText: s.emailText,
    priority: s.classifierResult.priority,
  }))
  .m((s) => ({
    priority: s.classifierResult.priority,
    rationale: s.rationaleResult.rationale,
  }));

// Train/validation sets
const train = [
  { emailText: 'URGENT: Server down!', priority: 'high' },
  { emailText: 'Meeting reminder for tomorrow', priority: 'normal' },
  { emailText: 'Weekly newsletter', priority: 'low' },
  { emailText: 'CRITICAL: Security breach', priority: 'high' },
  { emailText: 'Invoice overdue: please remit payment', priority: 'high' },
  { emailText: 'Lunch plans?', priority: 'low' },
  { emailText: 'New feature rollout announcement', priority: 'normal' },
  { emailText: 'Production bug impacting checkout', priority: 'high' },
  { emailText: 'Team offsite agenda attached', priority: 'normal' },
  { emailText: 'Discount code for loyal customers', priority: 'low' },
  { emailText: 'All-hands meeting cancelled', priority: 'normal' },
];

const val = [
  { emailText: 'Server CPU spiking—investigation needed', priority: 'high' },
  { emailText: 'Conference tickets available at discount', priority: 'low' },
  { emailText: 'Reminder: submit timesheets', priority: 'normal' },
  { emailText: 'Data breach follow-up actions required', priority: 'high' },
  { emailText: 'Happy birthday to our teammate!', priority: 'low' },
  { emailText: 'Office closed next Monday', priority: 'normal' },
];

// Multi-objective metric: accuracy + brevity of rationale
const metric = async ({
  prediction,
  example,
}: {
  prediction: any;
  example: any;
}) => {
  const acc = prediction?.priority === example?.priority ? 1 : 0;
  const rationale: string =
    typeof prediction?.rationale === 'string' ? prediction.rationale : '';
  const len = rationale.length;
  const brevity = len <= 30 ? 1 : len <= 60 ? 0.7 : len <= 100 ? 0.4 : 0.1;
  return { accuracy: acc, brevity } as Record<string, number>;
};

async function main() {
  if (!process.env.OPENAI_APIKEY) {
    console.error('❌ OPENAI_APIKEY is required');
    process.exit(1);
  }

  const student = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: AxAIOpenAIModel.GPT4OMini },
  });

  const teacher = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: AxAIOpenAIModel.GPT4O },
  });

  const optimizer = new AxGEPAFlow({
    studentAI: student,
    teacherAI: teacher,
    numTrials: 16,
    minibatch: true,
    minibatchSize: 6,
    earlyStoppingTrials: 5,
    minImprovementThreshold: -0.001,
    sampleCount: 1,
    verbose: true,
    debugOptimizer: false,
    seed: 42,
  });

  console.log(
    '🚀 Running GEPA-Flow Pareto optimization (accuracy + brevity)...'
  );
  const result = await optimizer.compile(
    flowEmail as any,
    train,
    metric as any,
    {
      auto: 'medium',
      verbose: true,
      validationExamples: val,
      maxMetricCalls: 240,
    }
  );

  console.log('\n✅ Pareto optimization complete');
  console.log(`Front size: ${result.paretoFrontSize}`);
  console.log(`Hypervolume (2D): ${result.hypervolume ?? 'N/A'}`);

  const frontier = [...result.paretoFront]
    .sort((a, b) => (b.dominatedSolutions || 0) - (a.dominatedSolutions || 0))
    .slice(0, 5);

  console.log('\nTop Pareto points:');
  for (const [i, p] of frontier.entries()) {
    const acc = (p.scores as any).accuracy ?? 0;
    const brev = (p.scores as any).brevity ?? 0;
    console.log(
      `  #${i + 1}: accuracy=${acc.toFixed(3)}, brevity=${brev.toFixed(3)}, config=${JSON.stringify(p.configuration)}`
    );
  }
}

main().catch((err) => {
  console.error('💥 GEPA-Flow Pareto example failed:', err);
  process.exit(1);
});
