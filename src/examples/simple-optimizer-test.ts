import {
  AxAI,
  AxAIOpenAIModel,
  AxBootstrapFewShot,
  type AxMetricFn,
  ax,
  axDefaultOptimizerLogger,
} from '@ax-llm/ax';

// Simple classification examples
const examples = [
  { emailText: 'URGENT: Server down!', priority: 'high' },
  { emailText: 'Meeting reminder for tomorrow', priority: 'normal' },
  { emailText: 'Weekly newsletter', priority: 'low' },
  { emailText: 'CRITICAL: Security breach', priority: 'high' },
  { emailText: 'Thank you for your feedback', priority: 'normal' },
];

// Simple generator for email classification
export const emailClassifier = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low" "Priority level"'
);

// Simple metric
const metric: AxMetricFn = ({ prediction, example }) => {
  return (prediction as any).priority === (example as any).priority ? 1 : 0;
};

console.log('=== Simple Optimizer Logging Demo ===\n');

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

const optimizer = new AxBootstrapFewShot({
  studentAI: ai,
  optimizerLogger: axDefaultOptimizerLogger,
  debugOptimizer: true,
  verbose: false, // Keep it clean
  options: {
    maxRounds: 3,
    maxDemos: 2,
  },
});

console.log('Starting clean optimization...\n');

const result = await optimizer.compile(
  emailClassifier as any,
  examples,
  metric
);

console.log('\n✅ Optimization Complete!');
console.log(`📊 Best Score: ${result.bestScore}`);
console.log(`🔧 Generated ${result.demos?.length || 0} demos`);
