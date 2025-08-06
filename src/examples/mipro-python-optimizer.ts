/**
 * MiPro optimization with Python service integration example.
 *
 * This example demonstrates how to use the MiPro optimizer with the
 * Python optimization service for sophisticated prompt tuning.
 */

import { AxAIOpenAIModel, type AxMetricFn, AxMiPRO, ai, ax } from '@ax-llm/ax';

// Training data for email prioritization
const trainingExamples = [
  {
    emailText: 'URGENT: Server is down, customers affected!',
    priority: 'critical',
  },
  { emailText: 'Meeting reminder for tomorrow at 3pm', priority: 'normal' },
  { emailText: 'Weekly newsletter - new features announced', priority: 'low' },
  { emailText: 'CRITICAL: Security breach detected', priority: 'critical' },
  { emailText: 'Thank you for your recent purchase', priority: 'low' },
  { emailText: 'Quarterly report is ready for review', priority: 'normal' },
  { emailText: 'ALERT: Payment processing failing', priority: 'critical' },
  { emailText: 'Team lunch next Friday', priority: 'low' },
  {
    emailText: 'Project deadline approaching - 2 days left',
    priority: 'normal',
  },
  { emailText: 'System maintenance scheduled for weekend', priority: 'normal' },
];

// Validation examples
const validationExamples = [
  {
    emailText: 'Emergency: Database corruption detected',
    priority: 'critical',
  },
  { emailText: 'Happy birthday wishes from the team', priority: 'low' },
  { emailText: 'Contract renewal discussion needed', priority: 'normal' },
  {
    emailText: 'IMMEDIATE ACTION: Compliance audit failed',
    priority: 'critical',
  },
  {
    emailText: 'Monthly team standup scheduled for next week',
    priority: 'low',
  },
  { emailText: 'Budget review meeting tomorrow at 2pm', priority: 'normal' },
  {
    emailText: 'URGENT: API rate limits exceeded, service degraded',
    priority: 'critical',
  },
  { emailText: 'New employee welcome lunch on Friday', priority: 'low' },
];

// Create the email classifier signature
export const emailClassifier = ax(
  'emailText:string "Email content to classify" -> priority:class "critical, normal, low" "Priority level of the email"'
);

// Metric function to evaluate predictions
const _accuracyMetric: AxMetricFn = ({ prediction, example }) => {
  const predicted = (prediction as any).priority;
  const expected = (example as any).priority;
  return predicted === expected ? 1.0 : 0.0;
};

// F1 score metric for more sophisticated evaluation
const f1Metric: AxMetricFn = ({ prediction, example }) => {
  const predicted = (prediction as any).priority;
  const expected = (example as any).priority;

  // Simple F1 approximation for single prediction
  if (predicted === expected) {
    return 1.0;
  }

  // Partial credit for close matches
  const priorityOrder = { critical: 3, normal: 2, low: 1 };
  const diff = Math.abs(
    (priorityOrder[predicted as keyof typeof priorityOrder] || 0) -
      (priorityOrder[expected as keyof typeof priorityOrder] || 0)
  );

  return diff === 1 ? 0.5 : 0.0;
};

console.log('=== MiPro with Python Optimizer Service Demo ===\n');

// Check if Python optimizer service is configured
const optimizerEndpoint =
  process.env.OPTIMIZER_ENDPOINT || 'http://localhost:8000';

// Initialize AI models
const studentModel = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT35TextDavinci002,
  },
});

// Use a stronger model as teacher if available
const teacherModel = process.env.OPENAI_APIKEY_TEACHER
  ? ai({
      name: 'openai',
      apiKey: process.env.OPENAI_APIKEY_TEACHER,
      config: {
        model: AxAIOpenAIModel.GPT4OMini,
      },
    })
  : undefined;

// Configure MiPro optimizer with built-in logger
const optimizer = new AxMiPRO({
  studentAI: studentModel,
  teacherAI: teacherModel,

  // MiPro-specific settings
  numCandidates: 5,
  maxBootstrappedDemos: 3,
  maxLabeledDemos: 4,
  numTrials: 50,

  // Minibatch evaluation for efficiency
  minibatch: true,
  minibatchSize: 25,
  minibatchFullEvalSteps: 10,

  // Advanced proposers
  programAwareProposer: true,
  dataAwareProposer: true,
  tipAwareProposer: true,
  fewshotAwareProposer: true,

  // Early stopping
  earlyStoppingTrials: 5,
  minImprovementThreshold: 0.02,

  // Bayesian optimization (when using Python service)
  bayesianOptimization: true,
  acquisitionFunction: 'expected_improvement' as const,
  explorationWeight: 0.15,

  // Self-consistency sampling
  sampleCount: 3,

  // Python optimizer integration
  optimizerEndpoint,
  optimizerTimeout: 60000,
  optimizerRetries: 3,

  // Enable built-in MiPro logging
  verbose: true,
});

// Combine all examples - optimizer will auto-split into train/validation
const allExamples = [...trainingExamples, ...validationExamples];

// Run optimization with MiPro
const result = await optimizer.compile(emailClassifier, allExamples, f1Metric);

console.log('\n=== Optimization Complete ===');
console.log(`Best score: ${result.bestScore.toFixed(3)}`);

// Apply optimized demos to the generator
if (result.demos) {
  emailClassifier.setDemos(result.demos);
  
  const testExamples = [
    'EMERGENCY: All services are down!',
    'Reminder: Submit your timesheet',
    'Free pizza in the break room',
  ];

  console.log('\n=== Testing Optimized Model ===');
  for (const emailText of testExamples) {
    const prediction = await emailClassifier.forward(studentModel, {
      emailText,
    });
    console.log(`"${emailText}" → ${prediction.priority}`);
  }
}

// Save optimization results
const fs = await import('node:fs/promises');
await fs.writeFile(
  'mipro_optimization_results.json',
  JSON.stringify(result.demos, null, 2)
);

/**
 * Usage Instructions:
 *
 * 1. Basic usage (TypeScript local optimization):
 *    OPENAI_APIKEY=your_key npm run tsx ./src/examples/mipro-python-optimizer.ts
 *
 * 2. With Python optimizer service:
 *    # First, start the Python service:
 *    cd src/optimizer && uv run ax-optimizer server start --debug
 *
 *    # Then run with Python optimizer:
 *    OPTIMIZER_ENDPOINT=http://localhost:8000 OPENAI_APIKEY=your_key npm run tsx ./src/examples/mipro-python-optimizer.ts
 *
 * 3. With custom endpoint:
 *    USE_PYTHON_OPTIMIZER=true OPTIMIZER_ENDPOINT=http://your-server:8000 OPENAI_APIKEY=your_key npm run tsx ./src/examples/mipro-python-optimizer.ts
 *
 * 4. With teacher model for better instruction generation:
 *    OPENAI_APIKEY=student_key OPENAI_APIKEY_TEACHER=teacher_key npm run tsx ./src/examples/mipro-python-optimizer.ts
 */
