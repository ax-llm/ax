import { AxAI, AxBootstrapFewShot, type AxMetricFn, ax } from '@ax-llm/ax';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

console.log('=== Optimizer Metrics Demo ===');

// Set up OpenTelemetry for metrics collection
const sdk = new NodeSDK({
  spanProcessor: new SimpleSpanProcessor(
    new OTLPTraceExporter({
      url: 'http://localhost:4318/v1/traces',
    })
  ),
});

sdk.start();

// Create AI service
const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Define a simple program to optimize
const emailClassifier = ax(
  'emailText:string "Email content" -> category:class "urgent, normal, low" "Priority level", confidence:number "Confidence score 0-1"'
);

// Training examples
const examples = [
  {
    emailText: 'URGENT: Server down, need immediate assistance!',
    category: 'urgent',
    confidence: 0.95,
  },
  {
    emailText: 'Meeting reminder for tomorrow at 2 PM',
    category: 'normal',
    confidence: 0.8,
  },
  {
    emailText: 'Weekly newsletter - new features available',
    category: 'low',
    confidence: 0.7,
  },
  {
    emailText: 'CRITICAL: Security breach detected',
    category: 'urgent',
    confidence: 0.9,
  },
  {
    emailText: 'Thank you for your feedback',
    category: 'normal',
    confidence: 0.6,
  },
];

// Validation examples
const _validationExamples = [
  {
    emailText: 'EMERGENCY: Database connection failed',
    category: 'urgent',
    confidence: 0.85,
  },
  {
    emailText: 'Monthly report attached',
    category: 'normal',
    confidence: 0.75,
  },
];

// Metric function to evaluate program performance
const metricFn: AxMetricFn = async ({ prediction, example }) => {
  // Simple accuracy metric
  const categoryMatch =
    (prediction as any).category === (example as any).category ? 1 : 0;
  const confidenceAccuracy =
    1 -
    Math.abs(
      Number((prediction as any).confidence) -
        Number((example as any).confidence)
    );

  return (categoryMatch + confidenceAccuracy) / 2;
};

// Create optimizer with metrics enabled
const optimizer = new AxBootstrapFewShot({
  studentAI: ai,
  targetScore: 0.9,
  verbose: true,
  options: {
    maxRounds: 5,
  },
  // Metrics will be automatically collected via OpenTelemetry
});

// Main execution function
const main = async () => {
  console.log('Starting optimization with metrics collection...');

  // Run optimization
  const startTime = Date.now();
  const result = await optimizer.compile(
    emailClassifier as any,
    examples,
    metricFn
  );
  const duration = Date.now() - startTime;

  console.log('\n=== Optimization Results ===');
  console.log(`Duration: ${duration}ms`);
  console.log(`Best Score: ${result.bestScore}`);
  console.log(`Total Calls: ${result.stats.totalCalls}`);
  console.log(`Successful Demos: ${result.stats.successfulDemos}`);
  console.log(`Estimated Token Usage: ${result.stats.estimatedTokenUsage}`);
  console.log(`Early Stopped: ${result.stats.earlyStopped}`);

  if (result.stats.earlyStopping) {
    console.log(`Early Stopping Reason: ${result.stats.earlyStopping.reason}`);
  }

  console.log('\n=== Resource Usage ===');
  console.log(`Total Tokens: ${result.stats.resourceUsage.totalTokens}`);
  console.log(`Total Time: ${result.stats.resourceUsage.totalTime}ms`);
  console.log(
    `Avg Latency per Eval: ${result.stats.resourceUsage.avgLatencyPerEval}ms`
  );

  console.log('\n=== Convergence Info ===');
  console.log(`Converged: ${result.stats.convergenceInfo.converged}`);
  console.log(
    `Final Improvement: ${result.stats.convergenceInfo.finalImprovement}`
  );
  console.log(
    `Stagnation Rounds: ${result.stats.convergenceInfo.stagnationRounds}`
  );

  if (result.demos) {
    console.log(`\nGenerated ${result.demos.length} demos`);
  }

  // Test the optimized program
  console.log('\n=== Testing Optimized Program ===');
  const testEmail = 'URGENT: Payment processing failed';
  const prediction = await emailClassifier.forward(ai, {
    emailText: testEmail,
  });

  console.log(`Test Email: "${testEmail}"`);
  console.log(`Predicted Category: ${prediction.category}`);
  console.log(`Confidence: ${prediction.confidence}`);

  // Shutdown OpenTelemetry
  await sdk.shutdown();

  console.log('\n=== Metrics Demo Complete ===');
  console.log('Check your OpenTelemetry collector for detailed metrics!');
};

// Run the main function
main().catch(console.error);
