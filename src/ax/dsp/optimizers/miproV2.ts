import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import { AxGen } from '../generate.js';
import type { AxOptimizerResult } from '../optimizer.js';
import {
  AxBaseOptimizer,
  type AxOptimizedProgram,
  AxOptimizedProgramImpl,
} from '../optimizer.js';
import { ax } from '../template.js';
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

// Extended result interface to include the optimized AxGen and unified optimization result
export interface AxMiPROResult<IN, OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedGen?: AxGen<IN, OUT>;
  optimizedProgram?: AxOptimizedProgram<OUT>;
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
  private optimizeTopP: boolean;

  // Self-consistency / multiple sampling
  private sampleCount: number;

  // JS Bayesian optimizer removed – Python service is required

  // Python optimizer integration
  private pythonClient?: PythonOptimizerClient;
  // Local histories for result object (base keeps its own private copies)
  private localScoreHistory: number[] = [];
  private localConfigurationHistory: Record<string, unknown>[] = [];
  // Optional custom result picker passed via optimizer args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly customResultPicker?: AxResultPickerFunction<any>;

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
    this.optimizeTopP = args.optimizeTopP ?? false;

    // Self-consistency options
    this.sampleCount = args.sampleCount ?? 1;
    // Optional custom picker
    this.customResultPicker = args.resultPicker as
      | AxResultPickerFunction<any>
      | undefined;

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
   * Default result picker used when sampleCount > 1 and no custom picker is provided.
   * Strategy:
   * - Function results: pick first non-error result, else index 0
   * - Field results: majority vote by JSON stringified output; ties → first seen
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly defaultResultPicker: AxResultPickerFunction<any> = async (
    data: Parameters<AxResultPickerFunction<any>>[0]
  ) => {
    if (data.type === 'function') {
      const idx = data.results.findIndex((r) => !r.isError);
      return idx >= 0 ? idx : 0;
    }
    const counts = new Map<string, { count: number; firstIndex: number }>();
    for (const r of data.results) {
      const key = JSON.stringify(r.sample ?? {});
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, { count: 1, firstIndex: r.index });
      }
    }
    let bestKey = '';
    let best = { count: -1, firstIndex: 0 };
    for (const [k, v] of counts.entries()) {
      if (v.count > best.count) {
        best = v;
        bestKey = k;
      }
    }
    return counts.get(bestKey)?.firstIndex ?? 0;
  };

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
      contextInfo += `\nPrevious Instructions (avoid repeating): ${previousInstructions
        .slice(-3)
        .join('; ')}`;
    }

    // Core instruction generation prompt inspired by paper's Appendix C.1
    const _instructionPrompt = `
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
      const gen = ax(
        'programSummary?:string "Program context" , datasetSummary?:string "Dataset context" , tip?:string "Generation tip" -> instructionText:string "Well-crafted instruction for the program"'
      );
      const out = await gen.forward(ai, {
        programSummary: programSummary ?? '',
        datasetSummary: datasetSummary ?? '',
        tip: tip ?? '',
      });
      const instruction = (out as any).instructionText as string | undefined;
      if (instruction && instruction.trim().length > 10) {
        return instruction.trim();
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

    if (this.programAwareProposer) {
      programSummary = await this.generateProgramSummary(_program, aiToUse);
    }

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
  private selectLabeledExamples<IN>(
    examples: readonly AxTypedExample<IN>[]
  ): AxTypedExample<IN>[] {
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
  // Local JS optimization loop removed

  // Local JS config evaluation removed

  // Shuffle utility removed

  private applyConfigToProgram<_IN, OUT extends AxGenOut>(
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
    const _startTime = Date.now();

    // Validate examples meet minimum requirements
    this.validateExamples(examples);

    // Initialize random seed if provided
    this.setupRandomSeed();

    // Configure auto settings if provided
    if (options?.auto) {
      this.configureAuto(options.auto);
    }

    // Python optimizer is REQUIRED for MiPRO v2
    if (!this.pythonClient) {
      throw new Error(
        'AxMiPRO v2 requires the Python optimizer service. Please configure optimizerEndpoint.'
      );
    }

    const isHealthy = await this.pythonClient.healthCheck();
    if (!isHealthy) {
      throw new Error('Python optimizer service is not available or unhealthy');
    }

    return await this.compilePython(program, examples, metricFn, options);
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
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  public validateProgram<IN, OUT extends AxGenOut>(
    _program: Readonly<AxGen<IN, OUT>>
  ): {
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

  // JS surrogate model and acquisition functions removed

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

    // Track optimization wall time
    const startTime = Date.now();

    // Reset local histories for this run
    this.localScoreHistory = [];
    this.localConfigurationHistory = [];

    const studyName = `mipro_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Propose instruction candidates
    const instructionCandidates = await this.proposeInstructionCandidates(
      program,
      _options,
      examples
    );

    const labeledDemosParams =
      this.maxLabeledDemos > 0 && examples.length > 0
        ? Array.from({ length: this.maxLabeledDemos }, (_, i) => ({
            name: `example_idx_${i}`,
            type: 'int' as const,
            low: 0,
            high: examples.length - 1,
          }))
        : [];

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
        // Add instruction parameter if candidates are available
        ...(instructionCandidates.length > 0
          ? ([
              {
                name: 'instruction',
                type: 'categorical' as const,
                choices: instructionCandidates,
              },
            ] as const)
          : []),
        // Add labeled demo selection parameters
        ...labeledDemosParams,
        // Optionally include topP as a conservative sampling knob
        ...(this.optimizeTopP
          ? ([
              {
                name: 'topP',
                type: 'float' as const,
                low: 0.7,
                high: 1.0,
              },
            ] as const)
          : ([] as const)),
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
        config: { jobId: job.job_id, numTrials: this.numTrials },
      },
    });

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestConfiguration: Record<string, unknown> | undefined;
    let totalTrials = 0;
    let stagnationRounds = 0;

    // Run optimization trials
    for (let trial = 0; trial < this.numTrials; trial++) {
      try {
        // Get parameter suggestion from Python service
        const suggestion = await this.pythonClient.suggestParameters(studyName);

        // Apply the suggested parameters - throw error if missing
        const { temperature, bootstrappedDemos, instruction, topP, ...rest } =
          suggestion.params;

        const exampleIndices = Object.keys(rest)
          .filter((key) => key.startsWith('example_idx_'))
          .map((key) => rest[key] as number)
          .filter((v) => typeof v === 'number');

        if (temperature === undefined) {
          throw new Error(
            `Missing temperature parameter in suggestion: ${JSON.stringify(
              suggestion
            )}`
          );
        }
        if (bootstrappedDemos === undefined) {
          throw new Error(
            `Missing bootstrappedDemos parameter in suggestion: ${JSON.stringify(
              suggestion
            )}`
          );
        }

        // Choose evaluation set: minibatch vs full
        const useFullEval =
          !this.minibatch ||
          (this.minibatchFullEvalSteps > 0 &&
            trial % this.minibatchFullEvalSteps ===
              this.minibatchFullEvalSteps - 1);

        // Random minibatch to reduce bias
        const evalSet = useFullEval
          ? [...examples]
          : (() => {
              const size = Math.min(this.minibatchSize, examples.length);
              const indices = new Set<number>();
              while (indices.size < size) {
                indices.add(Math.floor(Math.random() * examples.length));
              }
              return Array.from(indices).map((i) => examples[i]!);
            })();

        // Evaluate with the suggested parameters
        const score = await this.evaluateConfiguration(
          program,
          metricFn,
          {
            temperature: temperature as number,
            bootstrappedDemos: bootstrappedDemos as number,
            instruction: instruction as string | undefined,
            exampleIndices,
            topP: topP as number | undefined,
          },
          evalSet
        );

        totalTrials++;

        // Report the result back to Python optimizer
        await this.pythonClient.evaluateTrial({
          study_name: studyName,
          trial_number: suggestion.trial_number,
          value: score,
        });

        // Update best result and early stopping accounting
        if (score > bestScore + this.minImprovementThreshold) {
          bestScore = score;
          bestConfiguration = {
            ...suggestion.params,
            trialNumber: suggestion.trial_number,
          };
          stagnationRounds = 0;
        } else {
          stagnationRounds += 1;
        }

        // Update the current round for progress tracking
        this.currentRound = trial + 1;

        // Persist histories locally and via base helper (also emits logger + checkpoints)
        const configuration = {
          ...suggestion.params,
          trialNumber: suggestion.trial_number,
        };
        this.localScoreHistory.push(score);
        this.localConfigurationHistory.push(configuration);
        await this.updateOptimizationProgress(
          this.currentRound,
          score,
          configuration,
          'MiPRO (Python)',
          { sampler: 'TPESampler' },
          bestScore,
          bestConfiguration
        );

        // Report progress
        this.onProgress?.({
          round: trial + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore,
          tokensUsed: this.stats.estimatedTokenUsage,
          timeElapsed: Date.now() - startTime,
          successfulExamples: totalTrials,
          totalExamples: examples.length,
        });

        // Early stopping check
        if (
          this.earlyStoppingTrials > 0 &&
          stagnationRounds >= this.earlyStoppingTrials
        ) {
          const optLogger = this.getOptimizerLogger();
          optLogger?.({
            name: 'EarlyStopping',
            value: {
              reason: `No improvement ≥ ${this.minImprovementThreshold} for ${this.earlyStoppingTrials} trials`,
              finalScore: bestScore,
              round: this.currentRound,
            },
          });
          this.onEarlyStop?.(
            `No improvement for ${this.earlyStoppingTrials} trials`,
            this.stats
          );
          break;
        }
      } catch (_error) {
        // Continue with next trial - skip failed trials
      }
    }

    // Get final results from Python optimizer
    let finalBestScore = bestScore;
    let finalBestConfig = {};
    let bestDemos: AxProgramDemos<any, OUT>[] = [];

    try {
      const studyResults = await this.pythonClient.getStudyResults(studyName);
      finalBestScore = studyResults.best_value || bestScore;
      finalBestConfig = studyResults.best_params || {};

      // If we got a good configuration from Python, generate demos for it
      if (finalBestConfig && Object.keys(finalBestConfig).length > 0) {
        const bootstrappedDemos =
          (finalBestConfig as any).bootstrappedDemos || 0;
        if (bootstrappedDemos > 0) {
          // Generate demos using the best configuration
          bestDemos = await this.bootstrapFewShotExamples(
            program,
            metricFn,
            examples.slice(0, Math.floor(examples.length * 0.8)) // Use training split
          );
          bestDemos = bestDemos.slice(0, bootstrappedDemos);
        }
      }
    } catch (_error) {
      // Failed to get study results - use local tracking
    }

    // Build MiPRO-specific explanation using ax()
    let explanation:
      | {
          humanExplanation: string;
          recommendations: string[];
          performanceAssessment: string;
        }
      | undefined;
    try {
      const explainer = ax(
        'optimizerType:string "Optimizer name" , bestScore:number "Final best score" , totalCalls:number "Total eval calls" , successfulDemos:number "Successful evals" , bestConfig:json "Best configuration" -> humanExplanation:string "Readable summary", recommendations:string[] "Next steps", performanceAssessment:string "Performance notes"'
      );
      const out = await explainer.forward(this.studentAI, {
        optimizerType: 'MiPRO (Python)',
        bestScore: finalBestScore,
        totalCalls: this.stats.totalCalls,
        successfulDemos: this.stats.successfulDemos,
        bestConfig: finalBestConfig || {},
      });
      explanation = {
        humanExplanation: (out as any).humanExplanation ?? '',
        recommendations: ((out as any).recommendations ?? []) as string[],
        performanceAssessment: (out as any).performanceAssessment ?? '',
      };
    } catch {}

    // Log human-readable completion message
    await this.logOptimizationComplete(
      'MiPRO (Python)',
      finalBestScore,
      finalBestConfig,
      _options,
      explanation
    );

    // Cleanup
    try {
      await this.pythonClient.deleteStudy(studyName);
    } catch (_error) {
      // Ignore cleanup errors
    }

    // Update stats with final best score; per-eval accounting is handled in evaluateConfiguration
    this.stats.bestScore = finalBestScore;

    // Create optimized generator with best configuration
    const optimizedGen = new AxGen(program.getSignature());
    if (bestDemos.length > 0) {
      optimizedGen.setDemos(bestDemos);
    }
    if ((finalBestConfig as any).temperature) {
      // Store temperature in optimized generator - it will be used in forward calls via model config
      (optimizedGen as any)._optimizedModelConfig = {
        temperature: (finalBestConfig as any).temperature,
      };
    }

    // Create unified optimization result for Python path
    const optimizedProgram = new AxOptimizedProgramImpl<OUT>({
      bestScore: finalBestScore,
      stats: this.stats,
      instruction: (finalBestConfig as any).instruction,
      demos: bestDemos,
      examples: [],
      modelConfig: {
        temperature: (finalBestConfig as any).temperature,
        // Add other model config parameters as they are optimized
      },
      optimizerType: 'MiPRO (Python)',
      optimizationTime: Date.now() - startTime,
      totalRounds: this.numTrials,
      converged: this.stats.convergenceInfo.converged,
      scoreHistory: [...this.localScoreHistory],
      configurationHistory: [...this.localConfigurationHistory],
    });

    // Generate optimization insights report
    this.generateOptimizationReport(finalBestScore, bestDemos.length);

    return {
      bestScore: finalBestScore,
      demos: bestDemos,
      stats: this.stats,
      optimizedGen,
      optimizedProgram,
      finalConfiguration: {
        temperature: (finalBestConfig as any).temperature,
        bootstrappedDemos: (finalBestConfig as any).bootstrappedDemos || 0,
        ...finalBestConfig,
      },
    };
  }

  private generateOptimizationReport(
    bestScore: number | undefined,
    demosCount: number
  ): void {
    console.log('\n🎉 MiPRO Optimization Complete!\n');

    console.log('✅ Improvements:');
    if (bestScore !== undefined && bestScore > 0) {
      console.log(`• Best score achieved: ${bestScore.toFixed(3)}`);
    }
    if (demosCount > 0) {
      console.log(`• Generated ${demosCount} optimized demonstrations`);
    }
    console.log('• Systematic prompt and example optimization');
    console.log('• Automated instruction refinement process\n');

    console.log('⚠️ Limitations:');
    if (this.stats.totalCalls < 50) {
      console.log('• Relatively few optimization trials performed');
    }
    if (demosCount < 5) {
      console.log('• Limited number of demonstrations generated');
    }
    console.log('• Results depend on teacher model quality');
    console.log('• Optimization time increases with example complexity\n');

    console.log('🔍 Key Issues:');
    if (bestScore !== undefined && bestScore < 0.7) {
      console.log('• Final performance may still have room for improvement');
    }
    if (this.stats.convergenceInfo?.converged === false) {
      console.log('• Optimization may not have fully converged');
    }
    console.log('• Evaluation metrics may need domain-specific tuning');
    console.log('• Bootstrap quality depends on initial examples\n');

    console.log('💡 What This Means:');
    console.log('• MiPRO successfully automated prompt engineering');
    console.log(
      '• Optimized instructions and examples improve model performance'
    );
    console.log('• Framework reduces manual prompt engineering effort');
    console.log(
      '• More training data and iterations would likely improve results'
    );
  }

  /**
   * Simplified evaluation method for Python optimization
   */
  private async evaluateConfiguration<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    metricFn: AxMetricFn,
    config: {
      temperature: number;
      bootstrappedDemos: number;
      instruction?: string;
      exampleIndices?: number[];
      topP?: number;
    },
    examples: readonly AxExample[]
  ): Promise<number> {
    let totalScore = 0;
    let validResults = 0;
    let successCount = 0;

    // Use provided examples set (already mini-batched/full-selected by caller)
    const evaluationExamples = examples as readonly AxTypedExample<IN>[];

    // Apply instruction if provided
    if (config.instruction) {
      (program as any).setInstruction?.(config.instruction);
    }

    // Select labeled examples from the full set if indices are provided
    const labeledExamples = (config.exampleIndices ?? [])
      .map((i) => evaluationExamples[i])
      .filter((ex): ex is AxTypedExample<IN> => !!ex);

    if (labeledExamples.length > 0) {
      (program as any).setExamples?.(labeledExamples);
    }

    // Optional: Pre-bootstrap demos once and reuse for this configuration
    let demosForConfig: AxProgramDemos<any, OUT>[] = [];
    if (config.bootstrappedDemos > 0) {
      try {
        const bootstrapped = await this.bootstrapFewShotExamples(
          program,
          metricFn,
          evaluationExamples
        );
        demosForConfig = bootstrapped.slice(0, config.bootstrappedDemos);
      } catch {
        // If bootstrap fails, continue without demos
        demosForConfig = [];
      }
    }

    for (const example of evaluationExamples) {
      try {
        // Apply bootstrapped demos for this configuration if any were generated
        if (demosForConfig.length > 0) {
          // Best-effort application; program is Readonly in type but supports runtime mutation
          (program as any).setDemos?.(demosForConfig);
        }

        // Apply the optimized configuration (temperature) during evaluation
        const prediction = await program.forward(
          this.studentAI,
          example as IN,
          {
            modelConfig: {
              temperature: config.temperature,
              ...(config.topP !== undefined ? { topP: config.topP } : {}),
            },
            // Enable self-consistency if configured
            sampleCount: this.sampleCount,
            resultPicker:
              this.sampleCount > 1
                ? (this.customResultPicker ?? this.defaultResultPicker)
                : undefined,
          }
        );
        this.stats.totalCalls += 1;

        const score = await metricFn({ prediction, example });

        if (typeof score === 'number' && !Number.isNaN(score)) {
          totalScore += score;
          validResults++;
          const threshold =
            typeof this.targetScore === 'number' ? this.targetScore : 0.5;
          if (score >= threshold) {
            successCount++;
          }
        }
      } catch (_error) {
        // Use base logger if available
        const logger = this.getLogger();
        logger?.({
          name: 'Notification',
          id: 'mipro_evaluate',
          value: typeof _error === 'string' ? _error : String(_error),
        });
        // Continue with other examples
      }
    }

    this.stats.successfulDemos += successCount;
    return validResults > 0 ? totalScore / validResults : 0;
  }
}

// Local JS result picker removed
