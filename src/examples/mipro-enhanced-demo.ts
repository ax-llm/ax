import type { AxExample, AxMetricFn, AxMiPROCompileOptions } from '@ax-llm/ax';
import { AxAI, AxAIOpenAIModel, AxMiPRO, ax, f } from '@ax-llm/ax';

// Example: Enhanced Email Classification with MIPRO v2
console.log('=== Enhanced MIPRO v2 Demo ===');

// 1. Setup AI models
const studentAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini }, // Cheaper model for optimization
});

const teacherAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4O }, // More capable model for instruction generation
});

// 2. Create a complex classification program using modern template literals
export const emailClassifier = ax`
  emailText:${f.string('Email content to classify')} -> 
  category:${f.class(['urgent', 'important', 'normal', 'spam'], 'Email priority category')},
  confidence:${f.number('Confidence score 0-1')},
  reasoning:${f.string('Brief explanation for the classification')}
`;

// 3. Training examples with diverse email types
const trainingExamples: AxExample[] = [
  {
    emailText:
      'URGENT: Server outage affecting all customers. Need immediate response.',
    category: 'urgent',
    confidence: 0.95,
    reasoning: 'Contains urgent keyword and describes critical system failure',
  },
  {
    emailText: 'Meeting reminder: Quarterly review tomorrow at 2 PM',
    category: 'important',
    confidence: 0.8,
    reasoning: 'Work-related meeting with time constraint',
  },
  {
    emailText: 'Newsletter: 10 tips for better productivity this week',
    category: 'normal',
    confidence: 0.7,
    reasoning: 'Informational content, not time-sensitive',
  },
  {
    emailText: "You've won $1,000,000! Click here to claim your prize!!!",
    category: 'spam',
    confidence: 0.98,
    reasoning:
      'Classic spam pattern with unrealistic claims and suspicious formatting',
  },
  {
    emailText: 'Budget approval needed for Q4 marketing campaign by Friday',
    category: 'important',
    confidence: 0.85,
    reasoning: 'Business decision with clear deadline',
  },
  {
    emailText: 'RE: Project status update - all milestones on track',
    category: 'normal',
    confidence: 0.6,
    reasoning: 'Routine project communication',
  },
];

const validationExamples: AxExample[] = [
  {
    emailText: 'CRITICAL: Database corruption detected, backup systems failing',
    category: 'urgent',
    confidence: 0.9,
    reasoning: 'Critical system failure requiring immediate attention',
  },
  {
    emailText: 'Team lunch next Friday - please confirm attendance',
    category: 'normal',
    confidence: 0.6,
    reasoning: 'Social work event, not urgent',
  },
];

// 4. Define evaluation metric
const classificationMetric: AxMetricFn = ({ prediction, example }) => {
  // Multi-criteria evaluation
  const categoryMatch = prediction.category === example.category ? 1 : 0;
  const confidenceAccuracy =
    1 -
    Math.abs(
      ((prediction.confidence as number) || 0.5) -
        ((example.confidence as number) || 0.5)
    );

  // Weighted score emphasizing category correctness
  return categoryMatch * 0.7 + confidenceAccuracy * 0.3;
};

// 5. Create enhanced MIPRO optimizer with all new features
console.log('\n🚀 Initializing Enhanced MIPRO v2 Optimizer...');

const optimizer = new AxMiPRO({
  studentAI,
  teacherAI, // Teacher model for sophisticated instruction generation
  examples: trainingExamples,
  options: {
    // Core optimization settings
    numCandidates: 5,
    numTrials: 15,
    maxBootstrappedDemos: 3,
    maxLabeledDemos: 2,

    // 🆕 Enhanced AI-powered features
    programAwareProposer: true, // Analyze program structure
    dataAwareProposer: true, // Analyze dataset characteristics
    tipAwareProposer: true, // Use creative instruction tips
    fewshotAwareProposer: true, // Consider previous instructions

    // 🆕 Bayesian optimization with surrogate model
    bayesianOptimization: true,
    acquisitionFunction: 'expected_improvement', // Smart exploration
    explorationWeight: 0.1,

    // 🆕 Adaptive evaluation strategy
    minibatch: true,
    minibatchSize: 20,
    minibatchFullEvalSteps: 5, // Full evaluation every 5 trials

    // Performance settings
    earlyStoppingTrials: 4,
    minImprovementThreshold: 0.02,
    verbose: true,
  },
});

// 6. Run the enhanced optimization
console.log('\n⚡ Running Enhanced MIPRO Optimization...');
console.log('Features enabled:');
console.log('  ✅ AI-powered instruction generation with context');
console.log('  ✅ Bayesian optimization with acquisition functions');
console.log('  ✅ Program & data aware proposal generation');
console.log('  ✅ Adaptive minibatch evaluation');
console.log('  ✅ Surrogate model for efficient exploration\n');

const result = await optimizer.compile(emailClassifier, classificationMetric, {
  validationExamples: validationExamples,
  auto: 'medium', // Balanced optimization approach
} as AxMiPROCompileOptions);

// 7. Display results
console.log('\n🎯 Optimization Results:');
console.log(`Best Score: ${result.bestScore.toFixed(3)}`);
console.log(`Total Trials: ${result.stats.totalCalls}`);
console.log(`Successful Demos: ${result.stats.successfulDemos}`);
console.log(`Converged: ${result.stats.convergenceInfo.converged}`);

if (result.finalConfiguration) {
  console.log('\n📋 Optimized Configuration:');
  console.log(JSON.stringify(result.finalConfiguration, null, 2));
}

// 8. Test the optimized classifier
if (result.optimizedGen) {
  console.log('\n🧪 Testing Optimized Classifier:');

  const testEmails = [
    'EMERGENCY: Security breach detected in production environment',
    'Weekly team standup moved to Thursday 10 AM',
    "Congratulations! You've been selected for our exclusive offer!",
  ];

  for (const email of testEmails) {
    try {
      const classification = await result.optimizedGen.forward(studentAI, {
        emailText: email,
      });
      console.log(`\n📧 Email: "${email.substring(0, 50)}..."`);
      console.log(`   Category: ${classification.category}`);
      console.log(
        `   Confidence: ${(classification.confidence as number)?.toFixed(2)}`
      );
      console.log(`   Reasoning: ${classification.reasoning}`);
    } catch (error) {
      console.log(`   Error: ${error}`);
    }
  }
}

console.log('\n✨ Enhanced MIPRO Demo Complete!');
console.log('\nKey Improvements Demonstrated:');
console.log(
  '1. AI generates contextual instructions based on program structure'
);
console.log('2. Dataset analysis informs instruction generation');
console.log(
  '3. Bayesian optimization efficiently explores configuration space'
);
console.log('4. Adaptive evaluation balances speed and accuracy');
console.log('5. Surrogate model predicts performance without full evaluation');
