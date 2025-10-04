import {
  AxAI,
  AxAIOpenAIModel,
  AxGEPA,
  AxOptimizedProgramImpl,
  ax,
} from '@ax-llm/ax';

// GEPA Train + Inference example
// - Trains with a multi-objective metric (accuracy + brevity)
// - Produces an optimizedProgram (via GEPA) that can be saved/loaded
// - Applies the loaded optimization to a fresh program and runs inference

async function main() {
  if (!process.env.OPENAI_APIKEY) {
    console.error('❌ OPENAI_APIKEY is required');
    process.exit(1);
  }

  // Define a simple program: classify priority with a concise rationale
  const program = ax(
    'emailText:string "Email content" -> priority:class "high, normal, low" "Priority", rationale:string "One concise sentence"'
  );

  // Small train/validation datasets
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
  }): Promise<Record<string, number>> => {
    const acc = prediction?.priority === example?.priority ? 1 : 0;
    const rationale: string =
      typeof prediction?.rationale === 'string' ? prediction.rationale : '';
    const len = rationale.length;
    // Piecewise brevity: reward short, penalize long
    const brevity = len <= 30 ? 1 : len <= 60 ? 0.7 : len <= 100 ? 0.4 : 0.1;
    return { accuracy: acc, brevity };
  };

  // Student/Teacher AIs
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

  // Optimizer
  const optimizer = new AxGEPA({
    studentAI: student,
    teacherAI: teacher,
    numTrials: 3,
    minibatch: true,
    minibatchSize: 6,
    earlyStoppingTrials: 5,
    minImprovementThreshold: -0.001,
    sampleCount: 1,
    verbose: true,
    debugOptimizer: false,
    seed: 42,
  });

  console.log('🔧 Running GEPA Pareto optimization (accuracy + brevity)...');
  const result = await optimizer.compile(
    program as any,
    train,
    metric as any,
    {
      auto: 'medium',
      verbose: true,
      validationExamples: val,
      maxMetricCalls: 200, // required to bound evaluation cost
      // Optionally guide scalarization with a specific metric key
      // paretoMetricKey: 'accuracy',
    }
  );

  console.log(`\n✅ Pareto optimization complete`);
  console.log(`Front size: ${result.paretoFrontSize}`);
  console.log(`Hypervolume (2D): ${result.hypervolume ?? 'N/A'}`);

  // Show top frontier points (by dominatedSolutions)
  const frontier = [...result.paretoFront]
    .sort((a, b) => (b.dominatedSolutions || 0) - (a.dominatedSolutions || 0))
    .slice(0, 5);

  console.log('\nTop Pareto points:');
  for (const [i, p] of frontier.entries()) {
    const acc = (p.scores as any).accuracy ?? 0;
    const brev = (p.scores as any).brevity ?? 0;
    console.log(
      `  #${i + 1}: accuracy=${acc.toFixed(3)}, brevity=${brev.toFixed(
        3
      )}, config=${JSON.stringify(p.configuration)}`
    );
  }

  // Apply optimized configuration if available (mirrors MiPRO unified approach)
  const optimizedProgram = (result as any).optimizedProgram as
    | InstanceType<typeof AxOptimizedProgramImpl>
    | undefined;

  if (optimizedProgram) {
    program.applyOptimization(optimizedProgram as any);
    console.log('\n✅ Applied optimized configuration to program');

    // Save complete optimization to JSON
    const fs = await import('node:fs/promises');
    const savePath = 'gepa_optimized.json';
    await fs.writeFile(
      savePath,
      JSON.stringify(optimizedProgram, null, 2),
      'utf8'
    );
    console.log(`💾 Saved GEPA optimization to ${savePath}`);

    // Load and test the optimization (simulating production usage)
    const savedData = JSON.parse(await fs.readFile(savePath, 'utf8'));
    const loadedOptimization = new AxOptimizedProgramImpl(savedData);

    // Create a fresh program and apply the loaded optimization
    const testProgram = ax(
      'emailText:string "Email content" -> priority:class "high, normal, low" "Priority", rationale:string "One concise sentence"'
    );
    testProgram.applyOptimization(loadedOptimization);

    // Inference: quick test
    const testInput = {
      emailText: 'Prod incident: checkout returning 500 for EU users',
    };
    const testResult = await testProgram.forward(student, testInput);
    console.log(`\n🔎 Inference on fresh program:`);
    console.log(
      `priority=${(testResult as any).priority}, rationale="${
        (testResult as any).rationale
      }"`
    );
  } else {
    console.log(
      '\n⚠️ No optimizedProgram returned; choose a Pareto point manually if desired.'
    );
  }
}

main().catch((err) => {
  console.error('💥 GEPA Train+Inference example failed:', err);
  process.exit(1);
});
