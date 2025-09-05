import { AxAI, AxAIOpenAIModel, AxGEPA, ax } from '@ax-llm/ax';

// Two-objective demo: accuracy (classification) + brevity (short rationale)
const emailClassifier = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low" "Priority level", rationale:string "One concise sentence"'
);

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
  // Piecewise brevity: reward short, penalize long
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

  const optimizer = new AxGEPA({
    studentAI: student,
    teacherAI: teacher,
    numTrials: 16,
    minibatch: true,
    minibatchSize: 5,
    earlyStoppingTrials: 5,
    minImprovementThreshold: -0.001,
    sampleCount: 1,
    verbose: true,
    debugOptimizer: false,
  });

  console.log('🚀 Running GEPA Pareto optimization (accuracy + brevity)...');
  const result = await optimizer.compilePareto(
    emailClassifier as any,
    train,
    metric as any,
    { auto: 'medium', verbose: true, validationExamples: val } as any
  );

  console.log('\n✅ Pareto optimization complete');
  console.log(`Front size: ${result.paretoFrontSize}`);
  console.log(`Hypervolume (2D): ${result.hypervolume ?? 'N/A'}`);

  // Show up to top 5 frontier points (by dominatedSolutions desc)
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

  // Choose a compromise (weighted scalarization) for illustration
  const choose = (wAcc = 0.7, wBrev = 0.3) => {
    let best = frontier[0];
    let bestScore = -Infinity;
    for (const p of frontier) {
      const acc = (p.scores as any).accuracy ?? 0;
      const brev = (p.scores as any).brevity ?? 0;
      const s = wAcc * acc + wBrev * brev;
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    return { best, bestScore };
  };

  const { best, bestScore } = choose();
  console.log(
    `\n🎯 Chosen compromise score (0.7*acc + 0.3*brev): ${bestScore.toFixed(3)}`
  );
  console.log(`Chosen configuration: ${JSON.stringify(best.configuration)}`);
}

main().catch((err) => {
  console.error('💥 GEPA Pareto example failed:', err);
  process.exit(1);
});
