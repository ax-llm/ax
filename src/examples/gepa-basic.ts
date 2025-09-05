import { AxAI, AxAIOpenAIModel, AxGEPA, ax, type AxMetricFn } from '@ax-llm/ax';

// Basic classification task: email priority
const emailClassifier = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low" "Priority level"'
);

// Labeled sets (train + validation)
const examples = [
  { emailText: 'URGENT: Server down!', priority: 'high' },
  { emailText: 'Meeting reminder for tomorrow', priority: 'normal' },
  { emailText: 'Weekly newsletter', priority: 'low' },
  { emailText: 'CRITICAL: Security breach', priority: 'high' },
  { emailText: 'Thank you for your feedback', priority: 'normal' },
  { emailText: 'Invoice overdue: please remit payment', priority: 'high' },
  { emailText: 'Lunch plans?', priority: 'low' },
  { emailText: 'New feature rollout announcement', priority: 'normal' },
  { emailText: 'Production bug impacting checkout', priority: 'high' },
  { emailText: 'Team offsite agenda attached', priority: 'normal' },
  { emailText: 'Discount code for loyal customers', priority: 'low' },
  { emailText: 'All-hands meeting cancelled', priority: 'normal' },
];

const validationExamples = [
  { emailText: 'Server CPU spiking—investigation needed', priority: 'high' },
  { emailText: 'Conference tickets available at discount', priority: 'low' },
  { emailText: 'Reminder: submit timesheets', priority: 'normal' },
  { emailText: 'Data breach follow-up actions required', priority: 'high' },
  { emailText: 'Happy birthday to our teammate!', priority: 'low' },
  { emailText: 'Office closed next Monday', priority: 'normal' },
];

// Metric: exact match on the class label
const metric: AxMetricFn = async ({ prediction, example }) => {
  try {
    return (prediction as any).priority === (example as any).priority ? 1 : 0;
  } catch {
    return 0;
  }
};

async function main() {
  if (!process.env.OPENAI_APIKEY) {
    console.error('❌ OPENAI_APIKEY environment variable is required');
    process.exit(1);
  }

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: AxAIOpenAIModel.GPT4OMini },
  });

  const teacher = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: AxAIOpenAIModel.GPT4O },
  });

  // GEPA: reflective instruction evolution with Pareto sampling
  const optimizer = new AxGEPA({
    studentAI: ai,
    teacherAI: teacher,
    // Tunables (optional, reasonable defaults inside):
    numTrials: 18,
    minibatch: true,
    minibatchSize: 5,
    earlyStoppingTrials: 5,
    minImprovementThreshold: -0.001, // allow ties to pass gate
    sampleCount: 1,
    verbose: true,
    debugOptimizer: false,
  });

  console.log('🚀 Running GEPA optimization...');
  const result = await optimizer.compile(
    emailClassifier as any,
    examples,
    metric,
    { auto: 'medium', verbose: true, validationExamples } as any
  );

  console.log('✅ Optimization done');
  console.log(`🎯 Best score: ${result.bestScore.toFixed(3)}`);

  // Apply the optimized instruction and test a prediction
  const optimized = result.optimizedProgram;
  if (optimized) {
    optimized.applyTo(emailClassifier as any);
  }

  const testEmail = { emailText: 'FYI: Quarterly financial report attached' };
  const pred = await emailClassifier.forward(ai, testEmail as any);
  console.log('📨 Test prediction:', pred);
}

main().catch((err) => {
  console.error('💥 GEPA example failed:', err);
  process.exit(1);
});
