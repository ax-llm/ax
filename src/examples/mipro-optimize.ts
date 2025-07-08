import fs from 'node:fs/promises';
import {
  AxAI,
  AxAIOpenAIModel,
  type AxMetricFn,
  AxMiPRO,
  type AxMiPROCompileOptions,
  ax,
  axCreateOptimizerLogger,
  f,
} from '@ax-llm/ax';

/**
 * Complex reasoning examples that benefit from teacher model optimization
 * These require nuanced understanding that small models struggle with
 */
const complexReasoningExamples = [
  {
    scenario:
      "A company's revenue increased 25% but profit decreased 10%. The CEO says business is great.",
    analysis:
      "This is concerning. While revenue growth appears positive, the decrease in profit suggests rising costs, operational inefficiencies, or margin compression. The CEO's optimism may be misplaced or misleading to stakeholders.",
  },
  {
    scenario:
      'A politician promises to cut taxes and increase government spending simultaneously during a recession.',
    analysis:
      'This is economically contradictory and likely unsustainable. Cutting taxes reduces government revenue while increasing spending raises expenditures, leading to larger deficits. During a recession, this could worsen long-term fiscal health despite short-term stimulus effects.',
  },
  {
    scenario:
      'A startup claims 1000% user growth but admits 95% of users never return after first visit.',
    analysis:
      'The growth metric is misleading. High acquisition with 95% churn indicates severe product-market fit issues, unsustainable unit economics, and inflated vanity metrics. The real focus should be on retention and engagement, not raw user counts.',
  },
  {
    scenario:
      'A study shows correlation between ice cream sales and drowning deaths, leading to calls to ban ice cream.',
    analysis:
      'This confuses correlation with causation. Both ice cream sales and drowning deaths increase in summer due to hot weather and more swimming activity. The correlation is coincidental - temperature is the common cause. Banning ice cream would not reduce drowning deaths.',
  },
];

// Export the reasoning generator for reuse
export const reasoningGen = ax`
  scenario:${f.string('Business or logical scenario to analyze')} -> 
  analysis:${f.string('Critical analysis explaining what is wrong or misleading about the scenario')}
`;

// Sophisticated evaluation metric for reasoning quality
const reasoningMetric: AxMetricFn = ({ prediction, example }) => {
  const predicted = (prediction.analysis as string)?.toLowerCase() || '';
  const expected = (example.analysis as string)?.toLowerCase() || '';

  // Check for key reasoning concepts
  const reasoningIndicators = [
    'concerning',
    'misleading',
    'contradictory',
    'unsustainable',
    'correlation',
    'causation',
    'confuses',
    'however',
    'suggests',
    'indicates',
    'because',
    'therefore',
    'due to',
  ];

  let score = 0;

  // Basic content overlap
  if (predicted.includes(expected.slice(0, 50))) score += 0.3;

  // Check for reasoning indicators
  const predictedIndicators = reasoningIndicators.filter((word) =>
    predicted.includes(word)
  );
  const expectedIndicators = reasoningIndicators.filter((word) =>
    expected.includes(word)
  );

  if (predictedIndicators.length >= expectedIndicators.length * 0.5)
    score += 0.4;

  // Length and detail check (good reasoning should be detailed)
  if (predicted.length >= expected.length * 0.6) score += 0.3;

  return score;
};

console.log('=== Complex Reasoning Optimization Demo ===\n');

// Teacher model (GPT-4) for optimization
const teacherAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini }, // Use a capable model as teacher
});

console.log('Task: Analyze scenarios for logical flaws and misleading claims');
console.log('Teacher Model: GPT-4o-mini (high reasoning capability)');
console.log('Examples:', complexReasoningExamples.length);

// Create enhanced logger for better output
const enhancedLogger = axCreateOptimizerLogger();

const optimizer = new AxMiPRO({
  studentAI: teacherAI,
  examples: complexReasoningExamples,
  logger: enhancedLogger, // Use enhanced logger explicitly
  options: {
    numCandidates: 3,
    numTrials: 8,
    verbose: true,
  },
});

console.log('\n=== Running Optimization ===');

const result = await optimizer.compile(reasoningGen, reasoningMetric, {
  auto: 'medium', // More thorough optimization for complex task
} as AxMiPROCompileOptions); // Use proper type instead of any

console.log('\n✅ Optimization Complete!');

// Save just the demos
await fs.writeFile(
  'reasoning-demos.json',
  JSON.stringify(result.demos, null, 2)
);

console.log('💾 Saved demos to: reasoning-demos.json');
console.log(
  `📊 Successful demos: ${optimizer.getStats()?.successfulDemos ?? 0}`
);

// Quick test with teacher model
console.log('\n=== Testing Optimized Generator ===');
const testScenario =
  'A social media company boasts record user engagement while quietly reducing content moderation staff by 60%.';

// Set demos and test
if (result.demos) {
  reasoningGen.setDemos(result.demos);
}
const testResult = await reasoningGen.forward(teacherAI, {
  scenario: testScenario,
});

console.log('Test Scenario:', testScenario);
console.log('Analysis:', testResult.analysis);
