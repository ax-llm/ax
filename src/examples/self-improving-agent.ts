/**
 * AxLearn: Self-Improving Agent Example
 *
 * This example demonstrates how to use the AxLearn components
 * to create a self-improving agent that can:
 * 1. Log traces during production use
 * 2. Generate synthetic training data
 * 3. Evaluate outputs with LLM-as-a-Judge
 * 4. Tune prompts to improve performance
 */

import {
  AxJudge,
  AxLearnAgent,
  AxMemoryStorage,
  AxSynth,
  AxTraceLogger,
  AxTuner,
  ai,
  ax,
} from '@ax-llm/ax';

// Create the AI service
const llm = ai('openai', { model: 'gpt-4o-mini' });
const teacherLlm = ai('openai', { model: 'gpt-4o' });

// ============================================
// Example 1: Using AxTraceLogger for production logging
// ============================================

async function traceLoggerExample() {
  console.log('\n=== AxTraceLogger Example ===\n');

  const gen = ax(`customer_query -> helpful_response`);
  const storage = new AxMemoryStorage();

  // Wrap the generator with trace logging
  const tracedGen = new AxTraceLogger(gen, {
    agentId: 'support-bot',
    storage,
    onTrace: (trace) => {
      console.log(`Logged trace: ${trace.id}`);
      console.log(`  Duration: ${trace.durationMs}ms`);
    },
  });

  // Use exactly like a normal generator - traces are automatic
  const result = await tracedGen.forward(llm, {
    customer_query: 'I need help with my order #12345',
  });
  console.log(`Response: ${result.helpful_response}`);

  // Retrieve and analyze traces later
  const traces = await storage.getTraces('support-bot');
  console.log(`Total traces collected: ${traces.length}`);

  // Add user feedback to traces
  if (traces.length > 0) {
    await storage.addFeedback(traces[0].id, {
      score: 0.9,
      label: 'helpful',
      comment: 'Agent resolved the issue quickly',
    });
    console.log('Added feedback to trace');
  }
}

// ============================================
// Example 2: Using AxSynth for synthetic data generation
// ============================================

async function synthExample() {
  console.log('\n=== AxSynth Example ===\n');

  const signature = ax(`
    customer_complaint -> 
    resolution:string,
    sentiment:class "positive, neutral, negative"
  `).getSignature();

  const synth = new AxSynth(signature, {
    teacher: teacherLlm,
    domain: 'e-commerce customer support',
    edgeCases: ['angry customers', 'refund requests', 'shipping delays'],
  });

  // Generate synthetic training data
  const { examples, stats } = await synth.generate(5);

  console.log(`Generated ${stats.generated} examples in ${stats.durationMs}ms`);
  console.log(`Success rate: ${(stats.labelingSuccessRate * 100).toFixed(1)}%`);

  // Show sample examples
  for (const ex of examples.slice(0, 2)) {
    console.log(`\nCategory: ${ex.category}`);
    console.log(`Input: ${JSON.stringify(ex.input)}`);
    console.log(`Expected: ${JSON.stringify(ex.expected)}`);
  }
}

// ============================================
// Example 3: Using AxJudge - Polymorphic Evaluation
// ============================================

async function judgeExample() {
  console.log('\n=== AxJudge Polymorphic Evaluation ===\n');

  const signature = ax(`question -> answer`).getSignature();

  const judge = new AxJudge(signature, {
    ai: teacherLlm,
    randomizeOrder: true, // Reduce position bias in A/B comparisons
  });

  // MODE 1: Absolute (exact match with ground truth)
  console.log('--- Absolute Mode (Ground Truth) ---');
  const absoluteResult = await judge.evaluate(
    { question: 'What is 2+2?' },
    { answer: '4' }, // student
    { answer: '4' } // expected (ground truth)
  );
  console.log(`Mode: ${absoluteResult.mode}`);
  console.log(`Score: ${absoluteResult.score}`);
  console.log(`Reasoning: ${absoluteResult.reasoning}\n`);

  // MODE 2: Relativistic (compare student vs teacher)
  console.log('--- Relativistic Mode (Student vs Teacher) ---');
  const studentAnswer = await ax(`question -> answer`).forward(llm, {
    question: 'Explain photosynthesis briefly',
  });
  const teacherAnswer = await ax(`question -> answer`).forward(teacherLlm, {
    question: 'Explain photosynthesis briefly',
  });

  const relativisticResult = await judge.evaluate(
    { question: 'Explain photosynthesis briefly' },
    studentAnswer, // student output
    teacherAnswer // teacher output (reference)
  );
  console.log(`Mode: ${relativisticResult.mode}`);
  console.log(`Winner: ${relativisticResult.winner}`);
  console.log(`Score: ${relativisticResult.score}`);
  console.log(`Reasoning: ${relativisticResult.reasoning}\n`);

  // MODE 3: Reference-Free Mode (discrete quality tiers per RARO paper)
  console.log('--- Reference-Free Mode (Discrete Quality Tiers) ---');
  const refFreeResult = await judge.evaluate(
    { question: 'Write a haiku about coding' },
    {
      answer:
        'Bugs in the midnight\nKeyboard clicks echo softly\nCode compiles at dawn',
    }
    // No reference output - uses discrete quality classification
  );
  console.log(`Mode: ${refFreeResult.mode}`);
  console.log(`Quality Tier: ${refFreeResult.qualityTier}`);
  console.log(`Score: ${refFreeResult.score}`);
  console.log(`Reasoning: ${refFreeResult.reasoning}`);
}

// ============================================
// Example 4: Using AxTuner for optimization
// ============================================

async function tunerExample() {
  console.log('\n=== AxTuner Example ===\n');

  const gen = ax(`customer_query -> polite_response`);
  const storage = new AxMemoryStorage();

  const tuner = new AxTuner({
    teacher: teacherLlm,
    storage,
  });

  // Tune the generator
  const result = await tuner.tune(gen, {
    budget: 3, // Use low budget for demo
    synthCount: 10, // Generate 10 synthetic examples
    agentId: 'tuned-support-bot',
    onProgress: (p) => {
      console.log(`Round ${p.round}: score=${p.score.toFixed(2)}`);
    },
  });

  console.log(`\nFinal score: ${result.score.toFixed(2)}`);
  console.log(`Training examples: ${result.stats.trainingExamples}`);
  console.log(`Duration: ${result.stats.durationMs}ms`);

  if (result.checkpointVersion) {
    console.log(`Saved checkpoint: v${result.checkpointVersion}`);
  }

  // Use the improved generator
  const improved = result.improvedGen;
  const response = await improved.forward(llm, {
    customer_query: 'My package is late!',
  });
  console.log(`\nImproved response: ${response.polite_response}`);
}

// ============================================
// Example 5: Using AxLearnAgent (convenience wrapper)
// ============================================

async function agentExample() {
  console.log('\n=== AxLearnAgent Example ===\n');

  const gen = ax(`user_question -> helpful_answer`);

  // AxLearnAgent combines AxGen + AxTraceLogger + Tuning
  const agent = new AxLearnAgent(gen, {
    name: 'qa-bot-v1',
  });

  // Use in production - traces are automatically logged
  const result1 = await agent.forward(llm, {
    user_question: 'How do I reset my password?',
  });
  console.log(`Answer: ${result1.helpful_answer}`);

  const result2 = await agent.forward(llm, {
    user_question: 'What payment methods do you accept?',
  });
  console.log(`Answer: ${result2.helpful_answer}`);

  // Check traces
  const traces = await agent.getTraces();
  console.log(`\nTotal traces: ${traces.length}`);

  // Tune when ready (uncomment to run - takes time)
  // await agent.tune({
  //   teacher: teacherLlm,
  //   budget: 10,
  // });
}

// ============================================
// Run examples
// ============================================

async function main() {
  console.log('AxLearn: Self-Improving Agents Demo');
  console.log('===================================');

  try {
    await traceLoggerExample();
    await synthExample();
    await judgeExample();
    await tunerExample();
    await agentExample();

    console.log('\n✅ All examples completed!');
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
