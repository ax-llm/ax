import type { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  type AxBootstrapOptimizerOptions,
  type AxCompileOptions,
  type AxExample,
  type AxMetricFn,
  type AxOptimizerArgs,
  type AxOptimizerResult,
  type AxTypedExample,
} from '../optimizer.js';
import type {
  AxFieldValue,
  AxGenOut,
  AxProgramDemos,
  AxProgramTrace,
} from '../types.js';

// Define model config interface
interface ModelConfig {
  temperature: number;
  max_tokens?: number;
  [key: string]: number | string | boolean | undefined;
}

export class AxBootstrapFewShot extends AxBaseOptimizer {
  private maxRounds: number;
  private maxDemos: number;
  private maxExamples: number;
  private batchSize: number;
  private earlyStoppingPatience: number;
  private costMonitoring: boolean;
  private maxTokensPerGeneration: number;
  private verboseMode: boolean;
  private debugMode: boolean;
  private traces: AxProgramTrace<any, any>[] = [];

  constructor(
    args: Readonly<AxOptimizerArgs & { options?: AxBootstrapOptimizerOptions }>
  ) {
    // Call parent constructor
    super(args);

    const options = args.options || {};

    this.maxRounds = options.maxRounds ?? 3;
    this.maxDemos = options.maxDemos ?? 4;
    this.maxExamples = options.maxExamples ?? 16;
    this.batchSize = options.batchSize ?? 1;
    this.earlyStoppingPatience = options.earlyStoppingPatience ?? 0;
    this.costMonitoring = options.costMonitoring ?? false;
    this.maxTokensPerGeneration = options.maxTokensPerGeneration ?? 0;
    this.verboseMode = options.verboseMode ?? true;
    this.debugMode = options.debugMode ?? false;

    // Note: teacherAI from options can be used via compile options overrideTeacherAI
    // The base class provides methods to access teacher AI with fallbacks
  }

  private async compileRound<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    roundIndex: number,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<void> {
    const _st = Date.now();
    const maxDemos = options?.maxDemos ?? this.maxDemos;
    const aiOpt = {
      modelConfig: {
        temperature: 0.7,
      } as ModelConfig,
    };

    // Apply token limit if specified
    if (this.maxTokensPerGeneration > 0) {
      aiOpt.modelConfig.max_tokens = this.maxTokensPerGeneration;
    }

    const examplesSample = randomSample([...examples] as AxExample[], this.maxExamples);
    const previousSuccessCount = this.traces.length;

    // Process examples in batches if batch size > 1
    for (let i = 0; i < examplesSample.length; i += this.batchSize) {
      if (i > 0) {
        aiOpt.modelConfig.temperature = 0.7 + 0.001 * i;
      }

      const batch = examplesSample.slice(i, i + this.batchSize);

      // Process batch sequentially for now (could be parallelized if AI service supports it)
      for (const ex of batch) {
        if (!ex || typeof ex !== 'object') {
          continue;
        }

        // Use remaining examples as demonstration examples (excluding current one)
        const exList = examples.filter((e) => e !== ex);
        (program as AxGen<IN, OUT>).setExamples(
          exList as unknown as readonly (OUT & IN)[]
        );

        // Use teacher AI if provided, otherwise use student AI
        const aiService = this.getTeacherOrStudentAI();

        this.stats.totalCalls++;
        let res: OUT;

        try {
          // Add maxRetries to forward options
          const forwardOptions = {
            ...aiOpt,
            maxRetries: 1,
          };

          res = await program.forward(aiService, ex as IN, forwardOptions);

          // Estimate token usage if cost monitoring is enabled
          if (this.costMonitoring) {
            // Very rough estimate - replace with actual token counting from your AI service
            this.stats.estimatedTokenUsage +=
              JSON.stringify(ex).length / 4 + JSON.stringify(res).length / 4;
          }

          const score = await metricFn({ prediction: res, example: ex as AxExample });
          const success = score >= 0.5; // Assuming a threshold of 0.5 for success
          if (success) {
            this.traces = [...this.traces, ...program.getTraces()];
            this.stats.successfulDemos++;
          }
        } catch (error) {
          // Log the error but continue bootstrap - student model failures are expected during bootstrapping
          if (this.verboseMode || this.debugMode) {
            console.warn(
              `Student model failed during bootstrap: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
          res = {} as OUT;
        }

        // Remove progress bars - now handled by the optimizer logging system

        if (this.traces.length >= maxDemos) {
          return;
        }
      }
    }

    // Check if we should early stop based on no improvement
    if (this.earlyStoppingPatience > 0) {
      const newSuccessCount = this.traces.length;
      const improvement = newSuccessCount - previousSuccessCount;

      if (!this.stats.earlyStopping) {
        this.stats.earlyStopping = {
          bestScoreRound: improvement > 0 ? roundIndex : 0,
          patienceExhausted: false,
          reason: 'No improvement detected',
        };
      } else if (improvement > 0) {
        this.stats.earlyStopping.bestScoreRound = roundIndex;
      } else if (
        roundIndex - this.stats.earlyStopping.bestScoreRound >=
        this.earlyStoppingPatience
      ) {
        this.stats.earlyStopping.patienceExhausted = true;
        this.stats.earlyStopped = true;
        this.stats.earlyStopping.reason = `No improvement for ${this.earlyStoppingPatience} rounds`;

        return;
      }
    }
  }

  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxOptimizerResult<OUT>> {
    // Validate examples meet minimum requirements (Bootstrap doesn't split)
    this.validateExamples(examples, false);

    const maxRounds = options?.maxIterations ?? this.maxRounds;
    this.traces = [];

    // Reset stats using parent method
    this.reset();

    for (let i = 0; i < maxRounds; i++) {
      await this.compileRound(program, examples, i, metricFn, options);

      // Break early if early stopping was triggered
      if (this.stats.earlyStopped) {
        break;
      }
    }

    if (this.traces.length === 0) {
      throw new Error(
        'No demonstrations found. Either provide more examples or improve the existing ones.'
      );
    }

    const demos: AxProgramDemos<any, OUT>[] = groupTracesByKeys(this.traces);

    // Calculate best score from traces
    let bestScore = 0;
    if (this.traces.length > 0) {
      // Simple approximation - in a real implementation you'd track scores properly
      bestScore =
        this.stats.successfulDemos / Math.max(1, this.stats.totalCalls);
    }


    return {
      demos,
      stats: this.stats,
      bestScore,
      finalConfiguration: {
        maxRounds: this.maxRounds,
        maxDemos: this.maxDemos,
        batchSize: this.batchSize,
        successRate: bestScore,
      },
    };
  }
}

function groupTracesByKeys<IN, OUT>(
  programTraces: readonly AxProgramTrace<IN, OUT>[]
): AxProgramDemos<any, any>[] {
  const groupedTraces = new Map<string, Record<string, AxFieldValue>[]>();

  // Group all traces by their keys
  for (const programTrace of programTraces) {
    if (groupedTraces.has(programTrace.programId)) {
      const traces = groupedTraces.get(programTrace.programId);
      if (traces) {
        traces.push(programTrace.trace as any);
      }
    } else {
      groupedTraces.set(programTrace.programId, [programTrace.trace as any]);
    }
  }

  // Convert the Map into an array of ProgramDemos
  const programDemosArray: AxProgramDemos<any, any>[] = [];
  groupedTraces.forEach((traces, programId) => {
    programDemosArray.push({
      traces: traces as unknown as (OUT & IN)[],
      programId,
    });
  });

  return programDemosArray;
}

const randomSample = <T>(array: readonly T[], n: number): T[] => {
  // Clone the array to avoid modifying the original array
  const clonedArray = [...array];
  // Shuffle the cloned array
  for (let i = clonedArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const caI = clonedArray[i];
    const caJ = clonedArray[j];

    if (!caI || !caJ) {
      throw new Error('Invalid array elements');
    }

    [clonedArray[i], clonedArray[j]] = [caJ, caI];
  }
  // Return the first `n` items of the shuffled array
  return clonedArray.slice(0, n);
};
