import type { AxAIService } from '../../ai/types.js';
import { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  type AxCompileOptions,
  type AxExample,
  type AxMetricFn,
  type AxOptimizerArgs,
  type AxOptimizerResult,
  type AxTypedExample,
} from '../optimizer.js';
import type {
  AxGenOut,
  AxProgramDemos,
  AxResultPickerFunction,
} from '../types.js';

import { AxBootstrapFewShot } from './bootstrapFewshot.js';
import {
  PythonOptimizerClient,
  type PythonOptimizerClientOptions,
} from './pythonOptimizerClient.js';

interface ConfigType extends Record<string, unknown> {
  instruction: string;
  bootstrappedDemos: number;
  labeledExamples: number;
}

// Extended result interface to include the optimized AxGen
export interface AxMiPROResult<IN, OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedGen?: AxGen<IN, OUT>;
}

export class AxMiPRO extends AxBaseOptimizer {
  // MiPRO-specific options
  private maxBootstrappedDemos: number;
  private maxLabeledDemos: number;
  private numCandidates: number;
  private initTemperature: number;
  private numTrials: number;
  private minibatch: boolean;
  private minibatchSize: number;
  private minibatchFullEvalSteps: number;
  private programAwareProposer: boolean;
  private dataAwareProposer: boolean;
  private viewDataBatchSize: number;
  private tipAwareProposer: boolean;
  private fewshotAwareProposer: boolean;
  private earlyStoppingTrials: number;
  private minImprovementThreshold: number;
  private bayesianOptimization: boolean;
  private acquisitionFunction:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement';
  private explorationWeight: number;

  // Self-consistency / multiple sampling
  private sampleCount: number;

  // Surrogate model state for Bayesian optimization
  private miproConfigHistory: { config: ConfigType; score: number }[] = [];
  private surrogateModel: Map<string, { mean: number; variance: number }> =
    new Map();

  // Python optimizer integration
  private pythonClient?: PythonOptimizerClient;

  constructor(args: Readonly<AxOptimizerArgs>) {
    // Call parent constructor with base args
    super(args);

    // MiPRO-specific options with proper defaults - now from top-level args
    this.numCandidates = args.numCandidates ?? 5;
    this.initTemperature = args.initTemperature ?? 0.7;
    this.maxBootstrappedDemos = args.maxBootstrappedDemos ?? 3;
    this.maxLabeledDemos = args.maxLabeledDemos ?? 4;
    this.numTrials = args.numTrials ?? 30;
    this.minibatch = args.minibatch ?? true;
    this.minibatchSize = args.minibatchSize ?? 25;
    this.minibatchFullEvalSteps = args.minibatchFullEvalSteps ?? 10;
    this.programAwareProposer = args.programAwareProposer ?? true;
    this.dataAwareProposer = args.dataAwareProposer ?? true;
    this.viewDataBatchSize = args.viewDataBatchSize ?? 10;
    this.tipAwareProposer = args.tipAwareProposer ?? true;
    this.fewshotAwareProposer = args.fewshotAwareProposer ?? true;
    this.earlyStoppingTrials = args.earlyStoppingTrials ?? 5;
    this.minImprovementThreshold = args.minImprovementThreshold ?? 0.01;
    this.bayesianOptimization = args.bayesianOptimization ?? true;
    this.acquisitionFunction =
      args.acquisitionFunction ?? 'expected_improvement';
    this.explorationWeight = args.explorationWeight ?? 0.1;

    // Self-consistency options
    this.sampleCount = args.sampleCount ?? 1;

    // Initialize Python client if configured - use top-level args instead of nested options
    if (args.optimizerEndpoint) {
      const clientOptions: PythonOptimizerClientOptions = {
        endpoint: args.optimizerEndpoint,
        timeout: args.optimizerTimeout ?? 30000,
        retryAttempts: args.optimizerRetries ?? 3,
        logger: (msg) => {
          this.logger?.({
            name: 'Notification',
            id: 'python_client',
            value: typeof msg === 'string' ? msg : JSON.stringify(msg),
          });
        },
      };
      this.pythonClient = new PythonOptimizerClient(clientOptions);
    }

    // Update convergence threshold in stats
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  /**
   * Configures the optimizer for light, medium, or heavy optimization
   * @param level The optimization level: "light", "medium", or "heavy"
   */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numCandidates = 3;
        this.numTrials = 10;
        this.minibatch = true;
        this.minibatchSize = 20;
        break;
      case 'medium':
        this.numCandidates = 5;
        this.numTrials = 20;
        this.minibatch = true;
        this.minibatchSize = 25;
        break;
      case 'heavy':
        this.numCandidates = 7;
        this.numTrials = 30;
        this.minibatch = true;
        this.minibatchSize = 30;
        break;
    }
  }

  /**
   * Generates creative tips for instruction generation
   */
  private generateTips(): string[] {
    return [
      'Be very specific and detailed in your instructions.',
      'Focus on step-by-step reasoning in your instructions.',
      'Provide clear constraints and guidelines in your instructions.',
      'Keep your instructions concise and to the point.',
      'Emphasize accuracy and precision in your instructions.',
      'Include examples of good outputs in your instructions.',
      'Focus on handling edge cases in your instructions.',
      'Explicitly outline the reasoning process in your instructions.',
    ];
  }

  /**
   * Generates program summary for context-aware instruction generation
   */
  private async generateProgramSummary<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    ai: Readonly<AxAIService>
  ): Promise<string> {
    // Extract program structure information
    const signature = program.getSignature();

    // Create program summary prompt based on paper's Appendix C.5
    const summaryPrompt = `
Analyze this language model program and provide a concise summary of its purpose and structure.

Program Signature: ${signature}

Provide a 2-3 sentence summary focusing on:
1. The main task or purpose of this program
2. The input-output relationship
3. Any special constraints or requirements

Summary:`;

    try {
      const response = await ai.chat({
        chatPrompt: [{ role: 'user', content: summaryPrompt }],
      });
      if ('results' in response) {
        return (
          response.results[0]?.content?.trim() ||
          'General language model program'
        );
      }
      return 'General language model program';
    } catch {
      return 'General language model program';
    }
  }

  /**
   * Generates dataset summary for context-aware instruction generation
   */
  private async generateDatasetSummary(
    examples: readonly AxExample[],
    ai: Readonly<AxAIService>
  ): Promise<string> {
    if (examples.length === 0) return 'No examples available';

    // Sample a few examples for analysis (based on paper's approach)
    const sampleSize = Math.min(this.viewDataBatchSize, examples.length);
    const sampledExamples = examples.slice(0, sampleSize);

    // Create dataset summary prompt based on paper's Appendix C.3
    const exampleTexts = sampledExamples
      .map((ex, i) => `Example ${i + 1}: ${JSON.stringify(ex)}`)
      .join('\n');

    const summaryPrompt = `
Analyze this dataset and provide a concise summary of its characteristics.

Sample Examples:
${exampleTexts}

Provide a 2-3 sentence summary focusing on:
1. The type of data and domain
2. Common patterns or structures in the examples
3. Key challenges or requirements for processing this data

Dataset Summary:`;

    try {
      const response = await ai.chat({
        chatPrompt: [{ role: 'user', content: summaryPrompt }],
      });
      if ('results' in response) {
        return response.results[0]?.content?.trim() || 'General dataset';
      }
      return 'General dataset';
    } catch {
      return 'General dataset';
    }
  }

  /**
   * Enhanced instruction generation using AI with program and data awareness
   */
  private async generateInstruction({
    tip,
    candidateIndex,
    ai,
    programSummary,
    datasetSummary,
    previousInstructions = [],
  }: Readonly<{
    tip: string | undefined;
    candidateIndex: number;
    ai: Readonly<AxAIService>;
    programSummary?: string;
    datasetSummary?: string;
    previousInstructions?: string[];
  }>): Promise<string> {
    // Build context-aware instruction generation prompt based on paper
    let contextInfo = '';

    if (this.programAwareProposer && programSummary) {
      contextInfo += `\nProgram Context: ${programSummary}`;
    }

    if (this.dataAwareProposer && datasetSummary) {
      contextInfo += `\nDataset Context: ${datasetSummary}`;
    }

    if (this.fewshotAwareProposer && previousInstructions.length > 0) {
      contextInfo += `\nPrevious Instructions (avoid repeating): ${previousInstructions.slice(-3).join('; ')}`;
    }

    // Core instruction generation prompt inspired by paper's Appendix C.1
    const instructionPrompt = `
Generate a high-quality instruction for a language model program.

${contextInfo}

${tip ? `Tip: ${tip}` : ''}

Requirements:
1. Be specific and actionable
2. Focus on accuracy and clarity
3. Consider the program's purpose and data characteristics
4. Make the instruction distinct from previous ones
5. Keep it concise but comprehensive

Generate a single, well-crafted instruction:
Instruction:`;

    try {
      const response = await ai.chat({
        chatPrompt: [
          {
            role: 'user',
            content: instructionPrompt,
          },
        ],
      });

      if ('results' in response) {
        const instruction = response.results[0]?.content?.trim();
        if (instruction && instruction.length > 10) {
          return instruction;
        }
      }
    } catch (_error) {
      // AI instruction generation failed, will use fallback templates
    }

    // Fallback to enhanced templates if AI generation fails
    const enhancedTemplates = [
      'Analyze the input systematically and provide a precise, well-reasoned response.',
      'Think through this step-by-step, considering all relevant factors before responding.',
      'Examine the input carefully and generate an accurate, detailed answer.',
      'Process the information methodically and deliver a clear, comprehensive response.',
      'Consider the context thoroughly and provide a thoughtful, accurate answer.',
    ];

    let instruction =
      enhancedTemplates[candidateIndex % enhancedTemplates.length] ||
      enhancedTemplates[0]!;

    if (tip) {
      instruction = `${instruction} ${tip}`;
    }

    return instruction;
  }

  /**
   * Generates instruction candidates using enhanced AI-powered generation
   * @param options Optional compile options that may override teacher AI
   * @returns Array of generated instruction candidates
   */
  private async proposeInstructionCandidates<IN, OUT extends AxGenOut>(
    _program: Readonly<AxGen<IN, OUT>>,
    options?: AxCompileOptions,
    examples: readonly AxTypedExample<IN>[] = []
  ): Promise<string[]> {
    const instructions: string[] = [];
    const aiToUse = this.getTeacherOrStudentAI(options);

    // Generate contextual information if enabled
    let programSummary: string | undefined;
    let datasetSummary: string | undefined;


    if (this.dataAwareProposer) {
      datasetSummary = await this.generateDatasetSummary(
        [...examples] as AxExample[],
        aiToUse
      );
    }

    // Generate creative tips for tip-aware proposing
    const tips = this.tipAwareProposer ? this.generateTips() : [];

    // Generate instructions for each candidate
    for (let i = 0; i < this.numCandidates; i++) {
      const tipIndex = tips.length > 0 ? i % tips.length : -1;
      const tipToUse = tipIndex >= 0 ? tips[tipIndex] : undefined;

      const instruction = await this.generateInstruction({
        tip: tipToUse,
        candidateIndex: i,
        ai: aiToUse,
        programSummary,
        datasetSummary,
        previousInstructions: instructions, // Pass previous instructions for diversity
      });

      instructions.push(instruction);
    }

    return instructions;
  }

  /**
   * Bootstraps few-shot examples for the program
   */
  private async bootstrapFewShotExamples<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    metricFn: AxMetricFn,
    examples: readonly AxTypedExample<IN>[]
  ): Promise<AxProgramDemos<any, OUT>[]> {
    // Initialize the bootstrapper for this program
    const bootstrapper = new AxBootstrapFewShot({
      studentAI: this.studentAI,
      options: {
        maxDemos: this.maxBootstrappedDemos,
        maxRounds: 3,
        verboseMode: this.verbose ?? false,
      },
    });

    const result = await bootstrapper.compile(program, examples, metricFn, {
      maxDemos: this.maxBootstrappedDemos,
    });

    return (result.demos || []) as AxProgramDemos<any, OUT>[];
  }

  /**
   * Selects labeled examples directly from the training set
   */
  private selectLabeledExamples<IN>(examples: readonly AxTypedExample<IN>[]): AxTypedExample<IN>[] {
    const selectedExamples: AxTypedExample<IN>[] = [];

    // Random sampling from the training set
    const indices = new Set<number>();
    while (
      indices.size < this.maxLabeledDemos &&
      indices.size < examples.length
    ) {
      const idx = Math.floor(Math.random() * examples.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        const example = examples[idx];
        if (example) {
          selectedExamples.push(example);
        }
      }
    }

    return selectedExamples;
  }

  /**
   * Runs optimization to find the best combination of few-shot examples and instructions
   */
  private async runOptimization<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    bootstrappedDemos: readonly AxProgramDemos<any, OUT>[],
    labeledExamples: readonly AxTypedExample<IN>[],
    instructions: readonly string[],
    validationExamples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<{ bestConfig: ConfigType; bestScore: number }> {
    let bestConfig: ConfigType = {
      instruction: instructions[0] || '',
      bootstrappedDemos: Math.min(1, bootstrappedDemos.length),
      labeledExamples: Math.min(1, labeledExamples.length),
    };
    let bestScore = 0;
    let stagnationRounds = 0;
    const scoreHistory: number[] = [];

    // Check for checkpoint resume
    let startRound = 0;
    if (this.resumeFromCheckpoint) {
      const checkpoint = await this.loadCheckpoint(
        this.resumeFromCheckpoint,
        options
      );
      if (checkpoint && checkpoint.optimizerType === 'MiPRO') {
        this.restoreFromCheckpoint(checkpoint);
        startRound = checkpoint.currentRound;
        bestScore = checkpoint.bestScore;
        bestConfig = (checkpoint.bestConfiguration as ConfigType) || bestConfig;
        stagnationRounds =
          checkpoint.stats.convergenceInfo?.stagnationRounds || 0;
      }
    }

    // Optimization loop with early stopping and checkpointing
    const optLogger = this.getOptimizerLogger(options);
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'MiPRO',
        exampleCount: labeledExamples.length,
        validationCount: validationExamples.length,
        config: {
          numTrials: this.numTrials,
          numCandidates: instructions.length,
          bootstrappedDemos: bootstrappedDemos.length,
        },
      },
    });

    for (let i = startRound; i < this.numTrials; i++) {
      let config: ConfigType;

      if (this.bayesianOptimization && this.miproConfigHistory.length > 2) {
        // Use Bayesian optimization with acquisition function
        config = await this.selectConfigurationViaBayesianOptimization(
          instructions,
          bootstrappedDemos,
          labeledExamples
        );
      } else {
        // Random or round-robin selection (exploration phase)
        config = {
          instruction:
            instructions[i % instructions.length] || instructions[0] || '',
          bootstrappedDemos: Math.min(
            Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
            this.maxBootstrappedDemos
          ),
          labeledExamples: Math.min(
            Math.floor(Math.random() * (labeledExamples.length + 1)),
            this.maxLabeledDemos
          ),
        };
      }

      const score = await this.evaluateConfig(
        program,
        config,
        bootstrappedDemos,
        labeledExamples,
        validationExamples,
        metricFn,
        i + 1 // Pass current trial number for adaptive evaluation
      );

      // Log trial completion
      optLogger?.({
        name: 'RoundProgress',
        value: {
          round: i + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore: Math.max(score, bestScore),
          tokensUsed: this.stats.resourceUsage.totalTokens,
          configuration: config,
        },
      });

      // Update surrogate model with observed score
      this.updateSurrogateModel(config, score);

      scoreHistory.push(score);

      // Check for improvement
      const improvement = score - bestScore;
      if (improvement > this.minImprovementThreshold) {
        bestScore = score;
        bestConfig = config;
        stagnationRounds = 0;
        
        optLogger?.({
          name: 'BestConfigFound',
          value: {
            score: bestScore,
            config: config,
            improvement: improvement,
          },
        });
      } else {
        stagnationRounds++;
      }

      // Update optimization progress with checkpointing
      await this.updateOptimizationProgress(
        i + 1,
        score,
        config,
        'MiPRO',
        this.getConfiguration(),
        bestScore,
        bestConfig,
        {
          stagnationRounds,
          bootstrappedDemos: bootstrappedDemos.length,
          labeledExamples: labeledExamples.length,
          instructions: instructions.length,
        },
        options
      );

      // Progress callback
      if (this.onProgress) {
        this.onProgress({
          round: i + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore,
          tokensUsed: this.stats.resourceUsage.totalTokens,
          timeElapsed: Date.now(),
          successfulExamples: this.stats.successfulDemos,
          totalExamples: validationExamples.length,
          currentConfiguration: config,
          convergenceInfo: {
            improvement,
            stagnationRounds,
            isConverging: stagnationRounds < this.earlyStoppingTrials,
          },
        });
      }

      // Cost tracking check (handles token/time/cost budgets)
      if (this.checkCostLimits()) {
        this.triggerEarlyStopping('Cost limit reached', i + 1);
        break;
      }

      // Early stopping check
      if (stagnationRounds >= this.earlyStoppingTrials) {
        this.triggerEarlyStopping(
          `No improvement for ${this.earlyStoppingTrials} trials`,
          i - stagnationRounds + 1
        );
        break;
      }

      // Target score check
      if (this.checkTargetScore(bestScore)) {
        this.triggerEarlyStopping(
          `Target score ${this.targetScore} reached`,
          i + 1
        );
        break;
      }
    }

    // Update convergence info
    this.stats.convergenceInfo.stagnationRounds = stagnationRounds;
    this.stats.convergenceInfo.finalImprovement =
      scoreHistory.length > 1 ? bestScore - scoreHistory[0]! : 0;
    this.stats.convergenceInfo.converged =
      stagnationRounds < this.earlyStoppingTrials;

    return { bestConfig, bestScore };
  }

  private async evaluateConfig<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<any, OUT>[],
    labeledExamples: readonly AxExample[],
    validationExamples: readonly AxExample[],
    metricFn: AxMetricFn,
    currentTrial = 0
  ): Promise<number> {
    const testProgram = new AxGen(program.getSignature());
    this.applyConfigToProgram(
      testProgram,
      config,
      bootstrappedDemos,
      labeledExamples
    );

    let totalScore = 0;
    let count = 0;

    // Adaptive minibatch size based on paper's approach
    let evalSize: number;
    if (this.minibatch) {
      // Start with smaller batches and increase for more promising configurations
      const baseSize = Math.min(this.minibatchSize, validationExamples.length);

      // Use full evaluation for top configurations in later trials
      const isFullEvalTrial = currentTrial % this.minibatchFullEvalSteps === 0;
      if (isFullEvalTrial || currentTrial > this.numTrials * 0.8) {
        evalSize = Math.min(validationExamples.length, baseSize * 2);
      } else {
        // Stochastic minibatch evaluation
        evalSize = Math.max(3, Math.min(baseSize, validationExamples.length));
      }
    } else {
      evalSize = validationExamples.length;
    }

    // Randomly sample evaluation examples for stochastic evaluation
    const evalIndices = this.shuffleArray([
      ...Array(validationExamples.length).keys(),
    ]).slice(0, evalSize);
    const evalSet = evalIndices.map((i) => validationExamples[i]!);

    for (const example of evalSet) {
      try {
        const forwardOptions =
          this.sampleCount > 1
            ? {
                sampleCount: this.sampleCount,
                resultPicker:
                  axMajorityVotePicker<OUT>() as AxResultPickerFunction<AxGenOut>,
                maxRetries: 1,
              }
            : { maxRetries: 1 };

        const prediction = await testProgram.forward(
          this.studentAI,
          example as IN,
          forwardOptions
        );
        const score = await metricFn({ prediction, example });
        totalScore += score;
        count++;
        this.stats.totalCalls++;
      } catch (error) {
        // Log the error but continue optimization - student model failures are expected during optimization
        if (this.verbose) {
          console.warn(
            `[MiPRO] Student model failed during evaluation: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
        // Count failed attempts to track optimization health
        this.stats.totalCalls++;
      }
    }

    return count > 0 ? totalScore / count : 0;
  }

  /**
   * Fisher-Yates shuffle for stochastic evaluation
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled;
  }

  private applyConfigToProgram<IN, OUT extends AxGenOut>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<any, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the program supports it
    if (program.setInstruction) {
      program.setInstruction(config.instruction);
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0 && program.setDemos) {
      program.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos));
    }

    // Set examples if needed
    if (config.labeledExamples > 0 && program.setExamples) {
      program.setExamples(labeledExamples.slice(0, config.labeledExamples));
    }
  }

  /**
   * The main compile method to run MIPROv2 optimization
   */
  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxMiPROResult<IN, OUT>> {
    const startTime = Date.now();

    // Validate examples meet minimum requirements
    this.validateExamples(examples);

    // Initialize random seed if provided
    this.setupRandomSeed();

    // Configure auto settings if provided
    if (options?.auto) {
      this.configureAuto(options.auto);
    }

    // Check if Python optimizer should be used (based on presence of client)
    if (this.pythonClient) {
      // Check if Python service is available
      const isHealthy = await this.pythonClient.healthCheck();
      if (!isHealthy) {
        throw new Error(
          'Python optimizer service is not available or unhealthy'
        );
      }

      const optLogger = this.getOptimizerLogger(options);
      optLogger?.({
        name: 'OptimizationStart',
        value: {
          optimizerType: 'MiPRO (Python Service)',
          exampleCount: Math.floor(examples.length * 0.8),
          validationCount: Math.ceil(examples.length * 0.2),
          config: { pythonService: true, endpoint: this.optimizerEndpoint }
        },
      });

      return await this.compilePython(program, examples, metricFn, options);
    }

    // Auto-split examples into training and validation (80/20 split)
    const splitIndex = Math.floor(examples.length * 0.8);
    const trainingExamples = examples.slice(0, splitIndex);
    const validationExamples = examples.slice(splitIndex);


    // Step 1: Bootstrap few-shot examples
    let bootstrappedDemos: AxProgramDemos<IN, OUT>[] = [];
    if (this.maxBootstrappedDemos > 0) {
      bootstrappedDemos = await this.bootstrapFewShotExamples(
        program,
        metricFn,
        trainingExamples
      );

    }

    // Step 2: Select labeled examples from training set
    let labeledExamples: AxTypedExample<IN>[] = [];
    if (this.maxLabeledDemos > 0) {
      labeledExamples = this.selectLabeledExamples(trainingExamples);

    }

    // Step 3: Generate instruction candidates
    const instructions = await this.proposeInstructionCandidates(
      program,
      options,
      trainingExamples
    );


    // Step 4: Run optimization to find the best configuration
    const { bestConfig, bestScore } = await this.runOptimization(
      program,
      bootstrappedDemos,
      labeledExamples,
      instructions,
      validationExamples,
      metricFn,
      options
    );


    // Check if target score was reached
    if (this.checkTargetScore(bestScore)) {
      this.triggerEarlyStopping(
        `Target score ${this.targetScore} reached with score ${bestScore}`,
        this.numTrials
      );
    }

    // Create a new AxGen instance with the optimized configuration
    let signature: any;
    if (
      'getSignature' in program &&
      typeof program.getSignature === 'function'
    ) {
      signature = program.getSignature();
    } else {
      // Fallback: create a basic signature
      signature = 'input -> output';
    }

    const optimizedGen = new AxGen(signature);

    // Apply the best configuration to the new AxGen
    this.applyConfigToAxGen(
      optimizedGen,
      bestConfig,
      bootstrappedDemos,
      labeledExamples
    );

    // Update stats using parent class method
    this.updateResourceUsage(startTime);
    this.stats.convergenceInfo.converged = true;
    this.stats.convergenceInfo.finalImprovement = bestScore;

    // Save final checkpoint
    await this.saveFinalCheckpoint(
      'MiPRO',
      this.getConfiguration(),
      bestScore,
      bestConfig,
      {
        bootstrappedDemos: bootstrappedDemos.length,
        labeledExamples: labeledExamples.length,
        instructions: instructions.length,
        optimizedGen: !!optimizedGen,
      },
      options
    );

    return {
      demos: bootstrappedDemos,
      stats: this.stats,
      bestScore,
      optimizedGen,
      finalConfiguration: {
        instruction: bestConfig.instruction,
        bootstrappedDemos: bestConfig.bootstrappedDemos,
        labeledExamples: bestConfig.labeledExamples,
        numCandidates: this.numCandidates,
        numTrials: this.numTrials,
        sampleCount: this.sampleCount,
      },
    };
  }

  /**
   * Applies a configuration to an AxGen instance
   */
  private applyConfigToAxGen<IN, OUT extends AxGenOut>(
    axgen: Readonly<AxGen<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<any, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the AxGen supports it
    if (
      'setInstruction' in axgen &&
      typeof axgen.setInstruction === 'function'
    ) {
      axgen.setInstruction(config.instruction);
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0) {
      axgen.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos));
    }

    // Set examples if needed
    if (config.labeledExamples > 0) {
      axgen.setExamples(
        labeledExamples.slice(
          0,
          config.labeledExamples
        ) as unknown as readonly (OUT & IN)[]
      );
    }
  }

  /**
   * Get optimizer-specific configuration
   * @returns Current optimizer configuration
   */
  public getConfiguration(): Record<string, unknown> {
    return {
      numCandidates: this.numCandidates,
      initTemperature: this.initTemperature,
      maxBootstrappedDemos: this.maxBootstrappedDemos,
      maxLabeledDemos: this.maxLabeledDemos,
      numTrials: this.numTrials,
      minibatch: this.minibatch,
      minibatchSize: this.minibatchSize,
      minibatchFullEvalSteps: this.minibatchFullEvalSteps,
      programAwareProposer: this.programAwareProposer,
      dataAwareProposer: this.dataAwareProposer,
      tipAwareProposer: this.tipAwareProposer,
      fewshotAwareProposer: this.fewshotAwareProposer,
      earlyStoppingTrials: this.earlyStoppingTrials,
      minImprovementThreshold: this.minImprovementThreshold,
      bayesianOptimization: this.bayesianOptimization,
      acquisitionFunction: this.acquisitionFunction,
      explorationWeight: this.explorationWeight,
      sampleCount: this.sampleCount,
    };
  }

  /**
   * Update optimizer configuration
   * @param config New configuration to merge with existing
   */
  public updateConfiguration(config: Readonly<Record<string, unknown>>): void {
    if (config.numCandidates !== undefined) {
      this.numCandidates = config.numCandidates as number;
    }
    if (config.initTemperature !== undefined) {
      this.initTemperature = config.initTemperature as number;
    }
    if (config.maxBootstrappedDemos !== undefined) {
      this.maxBootstrappedDemos = config.maxBootstrappedDemos as number;
    }
    if (config.maxLabeledDemos !== undefined) {
      this.maxLabeledDemos = config.maxLabeledDemos as number;
    }
    if (config.numTrials !== undefined) {
      this.numTrials = config.numTrials as number;
    }
    if (config.minibatch !== undefined) {
      this.minibatch = config.minibatch as boolean;
    }
    if (config.minibatchSize !== undefined) {
      this.minibatchSize = config.minibatchSize as number;
    }
    if (config.earlyStoppingTrials !== undefined) {
      this.earlyStoppingTrials = config.earlyStoppingTrials as number;
    }
    if (config.minImprovementThreshold !== undefined) {
      this.minImprovementThreshold = config.minImprovementThreshold as number;
    }
    if (config.sampleCount !== undefined) {
      this.sampleCount = config.sampleCount as number;
    }
    // Note: verbose is now handled by the base class and cannot be updated here
  }

  /**
   * Reset optimizer state for reuse with different programs
   */
  public override reset(): void {
    super.reset();
    // Reset surrogate model state
    this.miproConfigHistory = [];
    this.surrogateModel.clear();
    // Update convergence threshold after reset
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  public validateProgram<IN, OUT extends AxGenOut>(_program: Readonly<AxGen<IN, OUT>>): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    // Start with empty validation result
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Add MiPRO-specific validation

    // Validation is now handled in the compile() method

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * Encodes a configuration into a string key for surrogate model lookup
   */
  private encodeConfiguration(config: Readonly<ConfigType>): string {
    // Create a proper hash of the instruction content, not just length!
    const instructionHash = this.hashString(config.instruction);
    return `${instructionHash}_${config.bootstrappedDemos}_${config.labeledExamples}`;
  }

  /**
   * Simple string hash function for instruction content
   */
  private hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Updates the surrogate model with a new configuration-score pair
   */
  private updateSurrogateModel(
    config: Readonly<ConfigType>,
    score: number
  ): void {
    this.miproConfigHistory.push({ config: { ...config }, score });

    // Simple Gaussian Process approximation for the surrogate model
    const key = this.encodeConfiguration(config);

    // Find similar configurations (same instruction length and demo counts)
    const similarConfigs = this.miproConfigHistory.filter(
      (entry) => this.encodeConfiguration(entry.config) === key
    );

    if (similarConfigs.length > 0) {
      const scores = similarConfigs.map((entry) => entry.score);
      const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const variance =
        scores.length > 1
          ? scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) /
            (scores.length - 1)
          : 0.1; // Default variance for single observation

      this.surrogateModel.set(key, { mean, variance });
    }
  }

  /**
   * Predicts performance using the surrogate model
   */
  private predictPerformance(config: Readonly<ConfigType>): {
    mean: number;
    variance: number;
  } {
    const key = this.encodeConfiguration(config);

    if (this.surrogateModel.has(key)) {
      return this.surrogateModel.get(key)!;
    }

    // For unseen configurations, use prior knowledge
    if (this.miproConfigHistory.length > 0) {
      // Find most similar configurations based on demo counts
      const similarities = this.miproConfigHistory.map((entry) => {
        const diff =
          Math.abs(entry.config.bootstrappedDemos - config.bootstrappedDemos) +
          Math.abs(entry.config.labeledExamples - config.labeledExamples);
        return { score: entry.score, similarity: 1 / (1 + diff) };
      });

      // Weighted average based on similarity
      const totalWeight = similarities.reduce(
        (sum, s) => sum + s.similarity,
        0
      );
      const weightedMean =
        similarities.reduce((sum, s) => sum + s.score * s.similarity, 0) /
        totalWeight;

      return { mean: weightedMean, variance: 0.2 }; // Higher variance for unseen configs
    }

    // Default prior for completely unknown configurations
    return { mean: 0.5, variance: 0.3 };
  }

  /**
   * Calculates acquisition function value for Bayesian optimization
   */
  private calculateAcquisitionValue(config: Readonly<ConfigType>): number {
    const prediction = this.predictPerformance(config);
    const { mean, variance } = prediction;
    const std = Math.sqrt(variance);

    // Current best score
    const bestScore =
      this.miproConfigHistory.length > 0
        ? Math.max(...this.miproConfigHistory.map((entry) => entry.score))
        : 0;

    switch (this.acquisitionFunction) {
      case 'expected_improvement': {
        const improvement = mean - bestScore;
        if (std === 0) return Math.max(0, improvement);

        const z = improvement / std;
        const phi = 0.5 * (1 + this.erf(z / Math.sqrt(2))); // CDF of standard normal
        const pdfValue = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); // PDF of standard normal

        return improvement * phi + std * pdfValue;
      }

      case 'upper_confidence_bound': {
        return mean + this.explorationWeight * std;
      }

      case 'probability_improvement': {
        const improvement = mean - bestScore;
        if (std === 0) return improvement > 0 ? 1 : 0;

        const z = improvement / std;
        return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
      }

      default:
        return mean;
    }
  }

  /**
   * Error function approximation for acquisition function calculations
   */
  private erf(x: number): number {
    // Abramowitz and Stegun approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    const absX = Math.abs(x);

    const t = 1.0 / (1.0 + p * absX);
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absX * absX);

    return sign * y;
  }

  /**
   * Selects the next configuration to evaluate using Bayesian optimization
   */
  private async selectConfigurationViaBayesianOptimization<IN, OUT extends AxGenOut>(
    instructions: readonly string[],
    bootstrappedDemos: readonly AxProgramDemos<any, OUT>[],
    labeledExamples: readonly AxExample[]
  ): Promise<ConfigType> {
    const candidates: Array<{ config: ConfigType; acquisitionValue: number }> =
      [];

    // Generate candidate configurations
    const numCandidates = Math.min(20, instructions.length * 3); // Reasonable number of candidates

    for (let i = 0; i < numCandidates; i++) {
      const config: ConfigType = {
        instruction:
          instructions[i % instructions.length] || instructions[0] || '',
        bootstrappedDemos: Math.min(
          Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
          this.maxBootstrappedDemos
        ),
        labeledExamples: Math.min(
          Math.floor(Math.random() * (labeledExamples.length + 1)),
          this.maxLabeledDemos
        ),
      };

      const acquisitionValue = this.calculateAcquisitionValue(config);
      candidates.push({ config, acquisitionValue });
    }

    // Sort by acquisition value (higher is better)
    candidates.sort((a, b) => b.acquisitionValue - a.acquisitionValue);

    // Return the most promising configuration
    return candidates[0]!.config;
  }

  /**
   * Python-based compilation method
   *
   * This is a simplified implementation that demonstrates integration
   * with the Python optimizer service. For now, it focuses on basic
   * parameter optimization rather than full MiPRO functionality.
   */
  private async compilePython<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    _options?: AxCompileOptions
  ): Promise<AxMiPROResult<IN, OUT>> {
    if (!this.pythonClient) {
      throw new Error('Python client not initialized');
    }

    const studyName = `mipro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create optimization request - simplified parameter set for now
    const optimizationRequest = {
      study_name: studyName,
      parameters: [
        {
          name: 'temperature',
          type: 'float' as const,
          low: 0.1,
          high: 2.0,
        },
        {
          name: 'bootstrappedDemos',
          type: 'int' as const,
          low: 0,
          high: this.maxBootstrappedDemos,
        },
      ],
      objective: {
        name: 'score',
        direction: 'maximize' as const,
      },
      n_trials: this.numTrials,
      sampler: 'TPESampler',
      pruner: this.minibatch ? 'MedianPruner' : undefined,
    };

    // Create the optimization job
    const job =
      await this.pythonClient.createOptimizationJob(optimizationRequest);

    const optLogger = this.getOptimizerLogger();
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'MiPRO (Python)',
        exampleCount: examples.length,
        validationCount: 0,
        config: { jobId: job.job_id, numTrials: this.numTrials }
      },
    });

    let bestScore = Number.NEGATIVE_INFINITY;
    const bestProgram = program;
    let totalTrials = 0;

    // Run optimization trials
    for (let trial = 0; trial < this.numTrials; trial++) {
      try {
        // Get parameter suggestion from Python service
        const suggestion = await this.pythonClient.suggestParameters(studyName);

        // Apply the suggested parameters (simplified implementation)
        const temperature = suggestion.params.temperature as number;
        const bootstrappedDemos = suggestion.params.bootstrappedDemos as number;

        // Evaluate with the suggested parameters
        const score = await this.evaluateConfiguration(
          program,
          metricFn,
          { temperature, bootstrappedDemos },
          this.minibatch
            ? examples.slice(0, this.minibatchSize)
            : examples
        );

        totalTrials++;

        // Report the result back to Python optimizer
        await this.pythonClient.evaluateTrial({
          study_name: studyName,
          trial_number: suggestion.trial_number,
          value: score,
        });

        // Update best result
        if (score > bestScore) {
          bestScore = score;
          // In a full implementation, we'd create an optimized program here
        }

        const optLogger = this.getOptimizerLogger();
        optLogger?.({
          name: 'RoundProgress',
          value: {
            round: trial + 1,
            totalRounds: this.numTrials,
            currentScore: score,
            bestScore: Math.max(score, bestScore || 0),
            tokensUsed: 0,
            configuration: { temperature },
          },
        });

        // Report progress
        this.onProgress?.({
          round: trial + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore,
          tokensUsed: this.stats.estimatedTokenUsage,
          timeElapsed: Date.now() - Date.now(), // Simplified
          successfulExamples: totalTrials,
          totalExamples: examples.length,
        });
      } catch (error) {
        const optLogger = this.getOptimizerLogger();
        optLogger?.({
          name: 'Notification',
          value: `Trial ${trial + 1} failed: ${error}`,
        });
        // Continue with next trial
      }
    }

    // Get final results from Python optimizer
    try {
      const studyResults = await this.pythonClient.getStudyResults(studyName);
      const optLogger = this.getOptimizerLogger();
      optLogger?.({
        name: 'OptimizationComplete',
        value: {
          bestScore: studyResults.best_value || 0,
          bestConfiguration: studyResults.best_params || {},
          stats: {
            totalCalls: studyResults.n_trials,
            successfulDemos: studyResults.n_trials,
          },
        },
      });
    } catch (error) {
      const optLogger = this.getOptimizerLogger();
      optLogger?.({
        name: 'Notification',
        value: `Failed to get study results: ${error}`,
      });
    }

    // Cleanup
    try {
      await this.pythonClient.deleteStudy(studyName);
    } catch (_error) {
      // Ignore cleanup errors
    }

    // Update stats
    this.stats.bestScore = bestScore;
    this.stats.totalCalls = totalTrials;

    return {
      bestScore,
      stats: this.stats,
      optimizedGen: bestProgram as AxGen<any, any>, // In full implementation, this would be the optimized program
    };
  }

  /**
   * Simplified evaluation method for Python optimization
   */
  private async evaluateConfiguration<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    metricFn: AxMetricFn,
    _config: { temperature: number; bootstrappedDemos: number },
    examples: readonly AxExample[]
  ): Promise<number> {
    let totalScore = 0;
    let validResults = 0;

    // Use a subset of examples for efficiency
    const evaluationExamples = examples.slice(0, Math.min(5, examples.length));

    for (const example of evaluationExamples) {
      try {
        // In a full implementation, we'd apply the config to create an optimized program
        // For now, we just use the original program
        const prediction = await program.forward(this.studentAI, example as IN);
        const score = await metricFn({ prediction, example });

        if (typeof score === 'number' && !Number.isNaN(score)) {
          totalScore += score;
          validResults++;
        }
      } catch (_error) {
        // Continue with other examples
      }
    }

    return validResults > 0 ? totalScore / validResults : 0;
  }
}

// ---------------------------------------
// Helper: Majority-vote result picker for self-consistency
// ---------------------------------------
const axMajorityVotePicker = <
  OUT extends AxGenOut,
>(): AxResultPickerFunction<OUT> => {
  // Return a picker function capturing no external state
  return async (data) => {
    // If we have field results, do majority vote on stringified payload
    if (data.type === 'fields') {
      const counts: Record<string, { count: number; index: number }> = {};
      for (const { index, sample } of data.results) {
        const key = JSON.stringify(sample);
        if (!counts[key]) {
          counts[key] = { count: 0, index };
        }
        counts[key]!.count += 1;
      }

      // Select the sample with highest count (ties -> first seen)
      let bestKey: string | undefined;
      let bestCount = -1;
      for (const [k, v] of Object.entries(counts)) {
        if (v.count > bestCount) {
          bestCount = v.count;
          bestKey = k;
        }
      }
      return counts[bestKey!]?.index ?? 0;
    }

    // For function results, fall back to first sample (could be improved)
    return data.results[0]?.index ?? 0;
  };
};
