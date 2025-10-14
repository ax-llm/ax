import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxOptimizationStats,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import { ax } from '../template.js';
import type { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  AxOptimizedProgramImpl,
  type AxOptimizedProgram,
  type AxOptimizerResult,
} from '../optimizer.js';
import type { AxGenOut } from '../types.js';

import {
  applyCuratorOperations,
  clonePlaybook,
  createEmptyPlaybook,
  dedupePlaybookByContent,
  renderPlaybook,
  updateBulletFeedback,
} from './acePlaybook.js';
import { f } from '../sig.js';
import type {
  AxACECuratorOperation,
  AxACECuratorOutput,
  AxACEFeedbackEvent,
  AxACEGeneratorOutput,
  AxACEOptimizationArtifact,
  AxACEPlaybook,
  AxACEReflectionOutput,
  AxACEOptions,
} from './aceTypes.js';

interface AxACECompileOptions extends AxCompileOptions {
  aceOptions?: AxACEOptions;
}

const DEFAULT_CONFIG: Required<
  Pick<
    AxACEOptions,
    | 'maxEpochs'
    | 'maxReflectorRounds'
    | 'maxSectionSize'
    | 'similarityThreshold'
    | 'allowDynamicSections'
  >
> = {
  maxEpochs: 1,
  maxReflectorRounds: 2,
  maxSectionSize: 25,
  similarityThreshold: 0.95,
  allowDynamicSections: true,
};

export interface AxACEResult<OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedProgram?: AxACEOptimizedProgram<OUT>;
  playbook: AxACEPlaybook;
  artifact: AxACEOptimizationArtifact;
}

/**
 * Optimized program artifact that persists ACE playbook updates.
 */
export class AxACEOptimizedProgram<
  OUT = any,
> extends AxOptimizedProgramImpl<OUT> {
  public readonly playbook: AxACEPlaybook;
  public readonly artifact: AxACEOptimizationArtifact;
  private readonly baseInstruction?: string;

  constructor(config: {
    baseInstruction?: string;
    playbook: AxACEPlaybook;
    artifact: AxACEOptimizationArtifact;
    bestScore: number;
    stats: AxOptimizationStats;
    optimizerType: string;
    optimizationTime: number;
    totalRounds: number;
    converged: boolean;
    instruction?: string;
    demos?: AxOptimizedProgram<OUT>['demos'];
    examples?: AxExample[];
    modelConfig?: AxOptimizedProgram<OUT>['modelConfig'];
    scoreHistory?: number[];
    configurationHistory?: Record<string, unknown>[];
  }) {
    super({
      bestScore: config.bestScore,
      stats: config.stats,
      instruction: config.instruction,
      demos: config.demos,
      examples: config.examples,
      modelConfig: config.modelConfig,
      optimizerType: config.optimizerType,
      optimizationTime: config.optimizationTime,
      totalRounds: config.totalRounds,
      converged: config.converged,
      scoreHistory: config.scoreHistory,
      configurationHistory: config.configurationHistory,
    });

    this.playbook = clonePlaybook(config.playbook);
    this.artifact = config.artifact;
    this.baseInstruction = config.baseInstruction;
  }

  public override applyTo<IN, T extends AxGenOut>(program: AxGen<IN, T>): void {
    super.applyTo(program);

    const signature = program.getSignature();
    const originalDescription =
      this.baseInstruction ?? signature.getDescription() ?? '';

    const combinedInstruction = [
      originalDescription.trim(),
      '',
      renderPlaybook(this.playbook),
    ]
      .filter((block) => block && block.trim().length > 0)
      .join('\n\n');

    program.setDescription(combinedInstruction);
  }
}

/**
 * AxACE implements the Agentic Context Engineering loop (Generator → Reflector → Curator).
 * The implementation mirrors the paper's architecture while integrating with the Ax optimizer
 * ergonomics (unified optimized program artifacts, metrics, and checkpointing).
 */
export class AxACE extends AxBaseOptimizer {
  private readonly aceConfig: Required<typeof DEFAULT_CONFIG> & {
    initialPlaybook?: AxACEPlaybook;
  };
  private playbook: AxACEPlaybook;
  private generatorHistory: AxACEFeedbackEvent[] = [];
  private deltaHistory: AxACEOptimizationArtifact['history'] = [];

  private reflectorProgram?: AxGen<any, any>;

  private curatorProgram?: AxGen<any, any>;

  constructor(
    args: Readonly<AxOptimizerArgs>,
    options?: Readonly<AxACEOptions>
  ) {
    super(args);

    this.aceConfig = {
      ...DEFAULT_CONFIG,
      ...options,
    };

    this.playbook =
      options?.initialPlaybook !== undefined
        ? clonePlaybook(options.initialPlaybook)
        : createEmptyPlaybook();
  }

  public override reset(): void {
    super.reset();
    this.playbook =
      this.aceConfig.initialPlaybook !== undefined
        ? clonePlaybook(this.aceConfig.initialPlaybook)
        : createEmptyPlaybook();
    this.generatorHistory = [];
    this.deltaHistory = [];
  }

  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.aceConfig.maxEpochs = 1;
        this.aceConfig.maxReflectorRounds = 1;
        break;
      case 'medium':
        this.aceConfig.maxEpochs = 2;
        this.aceConfig.maxReflectorRounds = 2;
        break;
      case 'heavy':
        this.aceConfig.maxEpochs = 3;
        this.aceConfig.maxReflectorRounds = 3;
        break;
    }
  }

  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxACECompileOptions
  ): Promise<AxACEResult<OUT>> {
    const aceOptions = (options as AxACECompileOptions | undefined)?.aceOptions;
    if (aceOptions) {
      Object.assign(this.aceConfig, {
        maxEpochs: aceOptions.maxEpochs ?? this.aceConfig.maxEpochs,
        maxReflectorRounds:
          aceOptions.maxReflectorRounds ?? this.aceConfig.maxReflectorRounds,
        maxSectionSize:
          aceOptions.maxSectionSize ?? this.aceConfig.maxSectionSize,
        similarityThreshold:
          aceOptions.similarityThreshold ?? this.aceConfig.similarityThreshold,
        allowDynamicSections:
          aceOptions.allowDynamicSections ??
          this.aceConfig.allowDynamicSections,
      });

      if (aceOptions.initialPlaybook) {
        this.playbook = clonePlaybook(aceOptions.initialPlaybook);
      }
    }

    const startTime = Date.now();
    this.validateExamples(examples);

    const baseInstruction = await this.extractProgramInstruction(program);
    const originalDescription = program.getSignature().getDescription() ?? '';

    this.generatorHistory = [];
    this.deltaHistory = [];

    let bestScore = Number.NEGATIVE_INFINITY;
    let round = 0;

    const epochs = Math.max(this.aceConfig.maxEpochs, 1);
    const totalRoundsTarget = epochs * examples.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let index = 0; index < examples.length; index++) {
        const example = examples[index]!;

        // Compose prompt with current playbook
        const composedInstruction = this.composeInstruction(
          baseInstruction ?? originalDescription,
          this.playbook
        );
        (program as any).setDescription?.(composedInstruction);

        const prediction = await program.forward(this.studentAI, example as IN);
        this.stats.totalCalls += 1;

        const score = await metricFn({
          prediction,
          example: example as AxExample,
        });

        if (typeof score === 'number') {
          this.stats.bestScore = Math.max(this.stats.bestScore, score);
          bestScore = Math.max(bestScore, score);
        }

        const predictedSeverity = (prediction as { severity?: string })
          ?.severity;
        const expectedSeverity = (example as { severity?: string })?.severity;

        const generatorOutput = this.createGeneratorOutput(prediction, example);

        const severityMismatch =
          expectedSeverity &&
          predictedSeverity &&
          expectedSeverity !== predictedSeverity;

        const reflection = await this.runReflector({
          example,
          generatorOutput,
          feedback:
            expectedSeverity &&
            predictedSeverity &&
            expectedSeverity !== predictedSeverity
              ? `Expected severity "${expectedSeverity}" but model predicted "${predictedSeverity}".`
              : undefined,
        });

        const rawCurator = await this.runCurator({
          example,
          reflection,
          playbook: this.playbook,
        });

        let operations = this.normalizeCuratorOperations(
          rawCurator?.operations
        );
        if (operations.length === 0 && severityMismatch) {
          operations = this.inferOperationsFromReflection(reflection);
        }

        const curatorResult =
          rawCurator || operations.length > 0
            ? ({
                ...(rawCurator ?? {}),
                operations,
              } as AxACECuratorOutput)
            : undefined;

        const appliedDeltaIds =
          operations.length > 0
            ? applyCuratorOperations(this.playbook, operations, {
                maxSectionSize: this.aceConfig.maxSectionSize,
                allowDynamicSections: this.aceConfig.allowDynamicSections,
              }).updatedBulletIds
            : [];

        if (reflection?.bulletTags) {
          for (const tag of reflection.bulletTags) {
            updateBulletFeedback(this.playbook, tag.id, tag.tag);
          }
        }

        if (operations.length > 0 && appliedDeltaIds.length > 0) {
          dedupePlaybookByContent(
            this.playbook,
            this.aceConfig.similarityThreshold
          );
        }

        const feedbackEvent: AxACEFeedbackEvent = {
          example: example as AxExample,
          prediction,
          score: typeof score === 'number' ? score : 0,
          generatorOutput,
          reflection,
          curator: curatorResult,
          timestamp: new Date().toISOString(),
        };

        this.generatorHistory.push(feedbackEvent);

        if (appliedDeltaIds.length > 0 && curatorResult?.operations?.length) {
          this.deltaHistory.push({
            epoch,
            exampleIndex: index,
            operations: curatorResult.operations,
          });
        }

        round += 1;
        this.currentRound = round;

        const numericScore =
          typeof score === 'number' && Number.isFinite(score) ? score : 0;
        const bestScoreForProgress = Number.isFinite(bestScore)
          ? bestScore
          : numericScore;

        const progressOptions: AxACECompileOptions = {
          ...(options ?? {}),
          maxIterations: totalRoundsTarget,
        };

        await this.updateOptimizationProgress(
          round,
          numericScore,
          {
            epoch,
            exampleIndex: index,
            playbookBullets: this.playbook.stats.bulletCount,
          },
          'ACE',
          { epochs },
          bestScoreForProgress,
          {
            playbookBullets: this.playbook.stats.bulletCount,
          },
          undefined,
          progressOptions
        );

        this.stats.convergenceInfo.finalImprovement = Math.max(
          this.stats.convergenceInfo.finalImprovement,
          numericScore
        );
      }
    }

    const optimizationTime = Date.now() - startTime;
    this.stats.resourceUsage.totalTime = optimizationTime;
    this.stats.convergenceInfo.converged = true;
    this.stats.bestScore = Number.isFinite(bestScore) ? bestScore : 0;

    const artifact: AxACEOptimizationArtifact = {
      playbook: clonePlaybook(this.playbook),
      feedback: [...this.generatorHistory],
      history: [...this.deltaHistory],
    };

    const optimizedProgram = new AxACEOptimizedProgram<OUT>({
      baseInstruction: baseInstruction ?? originalDescription,
      playbook: this.playbook,
      artifact,
      bestScore: Number.isFinite(bestScore) ? bestScore : 0,
      stats: this.stats,
      optimizerType: 'ACE',
      optimizationTime,
      totalRounds: round,
      converged: this.stats.convergenceInfo.converged,
    });

    // Restore original description to avoid mutating caller program after compile
    (program as any).setDescription?.(originalDescription);

    const result: AxACEResult<OUT> = {
      stats: this.stats,
      bestScore: Number.isFinite(bestScore) ? bestScore : 0,
      finalConfiguration: {
        strategy: 'ace',
        epochs,
      },
      optimizedProgram,
      playbook: clonePlaybook(this.playbook),
      artifact,
    };
    return result;
  }

  /**
   * Apply ACE updates after each online inference. Mirrors the online adaptation
   * flow described in the paper; can be called by user-land code between queries.
   */
  public async applyOnlineUpdate(
    args: Readonly<{
      example: AxExample;
      prediction: unknown;
      feedback?: string;
    }>
  ): Promise<AxACECuratorOutput | undefined> {
    const generatorOutput = this.createGeneratorOutput(
      args.prediction,
      args.example
    );

    const predictedSeverity = (args.prediction as { severity?: string })
      ?.severity;
    const expectedSeverity = (args.example as { severity?: string })?.severity;

    const reflection = await this.runReflector({
      example: args.example,
      generatorOutput,
      feedback:
        args.feedback ??
        (expectedSeverity &&
        predictedSeverity &&
        expectedSeverity !== predictedSeverity
          ? `Expected severity "${expectedSeverity}" but model predicted "${predictedSeverity}".`
          : undefined),
    });

    const rawCurator = await this.runCurator({
      example: args.example,
      reflection,
      playbook: this.playbook,
    });

    let operations = this.normalizeCuratorOperations(rawCurator?.operations);
    const severityMismatch =
      expectedSeverity &&
      predictedSeverity &&
      expectedSeverity !== predictedSeverity;
    if (operations.length === 0 && severityMismatch) {
      operations = this.inferOperationsFromReflection(reflection);
    }

    const curatorResult =
      rawCurator || operations.length > 0
        ? ({
            ...(rawCurator ?? {}),
            operations,
          } as AxACECuratorOutput)
        : undefined;

    if (reflection?.bulletTags) {
      for (const tag of reflection.bulletTags) {
        updateBulletFeedback(this.playbook, tag.id, tag.tag);
      }
    }

    if (operations.length > 0) {
      applyCuratorOperations(this.playbook, operations, {
        maxSectionSize: this.aceConfig.maxSectionSize,
        allowDynamicSections: this.aceConfig.allowDynamicSections,
      });
      dedupePlaybookByContent(
        this.playbook,
        this.aceConfig.similarityThreshold
      );
    }

    const feedbackEvent: AxACEFeedbackEvent = {
      example: args.example,
      prediction: args.prediction,
      score: 0,
      generatorOutput,
      reflection,
      curator: curatorResult,
      timestamp: new Date().toISOString(),
    };

    this.generatorHistory.push(feedbackEvent);

    return curatorResult;
  }

  private composeInstruction(
    baseInstruction: string,
    playbook: AxACEPlaybook
  ): string {
    const instructionParts = [
      baseInstruction.trim(),
      '',
      renderPlaybook(playbook),
    ].filter((part) => part.trim().length > 0);

    return instructionParts.join('\n\n');
  }

  private async extractProgramInstruction<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>
  ): Promise<string | undefined> {
    try {
      const signature = program.getSignature();
      return signature.getDescription() ?? undefined;
    } catch {
      return undefined;
    }
  }

  private createGeneratorOutput<IN>(
    prediction: unknown,
    example: AxTypedExample<IN>
  ): AxACEGeneratorOutput {
    const reasoning =
      (prediction as Record<string, unknown>)?.thought?.toString() ?? '';

    const bulletIds = Array.isArray(
      (prediction as Record<string, unknown>)?.bullet_ids
    )
      ? ((prediction as Record<string, unknown>)?.bullet_ids as string[])
      : [];

    return {
      reasoning,
      answer: prediction,
      bulletIds,
      trajectory: JSON.stringify({
        example,
        prediction,
      }),
      metadata: {
        predictedSeverity: (prediction as { severity?: string })?.severity,
        expectedSeverity: (example as { severity?: string })?.severity,
      },
    };
  }

  private normalizeCuratorOperations(
    operations: unknown
  ): AxACECuratorOperation[] {
    if (!operations) {
      return [];
    }

    if (Array.isArray(operations)) {
      const normalized: AxACECuratorOperation[] = [];
      const seen = new Set<string>();

      for (const entry of operations) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const typeRaw = (entry as { type?: string }).type ?? 'ADD';
        const typeUpper =
          typeof typeRaw === 'string' ? typeRaw.toUpperCase() : 'ADD';
        const type: AxACECuratorOperation['type'] =
          typeUpper === 'UPDATE'
            ? 'UPDATE'
            : typeUpper === 'REMOVE'
              ? 'REMOVE'
              : 'ADD';

        const sectionRaw =
          (entry as { section?: string }).section ?? 'Guidelines';
        const section =
          typeof sectionRaw === 'string' && sectionRaw.trim().length > 0
            ? sectionRaw.trim()
            : 'Guidelines';

        const contentRaw = (entry as { content?: string }).content ?? '';
        const content = typeof contentRaw === 'string' ? contentRaw.trim() : '';

        if (type !== 'REMOVE' && content.length === 0) {
          continue;
        }

        const key = `${type}:${section}:${content}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const normalizedEntry: AxACECuratorOperation = {
          type,
          section,
        };

        if (type !== 'REMOVE') {
          normalizedEntry.content = content;
        }

        const metadataRaw = (entry as { metadata?: Record<string, unknown> })
          .metadata;
        if (metadataRaw && typeof metadataRaw === 'object') {
          normalizedEntry.metadata = { ...metadataRaw };
        }

        normalized.push(normalizedEntry);
      }

      return normalized;
    }

    if (typeof operations === 'string') {
      try {
        const parsed = JSON.parse(operations);
        return this.normalizeCuratorOperations(parsed);
      } catch {
        return [];
      }
    }

    if (typeof operations === 'object') {
      const opsObj = operations as { operations?: unknown };
      if (opsObj && Array.isArray(opsObj.operations)) {
        return this.normalizeCuratorOperations(opsObj.operations);
      }
      if (opsObj && typeof opsObj.operations === 'string') {
        try {
          const parsed = JSON.parse(opsObj.operations);
          return this.normalizeCuratorOperations(parsed);
        } catch {
          return [];
        }
      }
      return [];
    }

    return [];
  }

  private inferOperationsFromReflection(
    reflection?: AxACEReflectionOutput
  ): AxACECuratorOperation[] {
    if (!reflection) {
      return [];
    }

    const operations: AxACECuratorOperation[] = [];
    const seen = new Set<string>();

    const addOperation = (section: string, content?: string) => {
      if (!content) {
        return;
      }
      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }
      const lower = trimmed.toLowerCase();
      if (lower.startsWith('no error')) {
        return;
      }
      const key = `${section}:${trimmed}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      operations.push({
        type: 'ADD',
        section,
        content: trimmed,
      });
    };

    addOperation('Guidelines', reflection.keyInsight);
    addOperation('Response Strategies', reflection.correctApproach);
    addOperation('Common Pitfalls', reflection.errorIdentification);
    addOperation('Root Cause Notes', reflection.rootCauseAnalysis);

    return operations;
  }

  private async runReflector({
    example,
    generatorOutput,
    feedback,
  }: Readonly<{
    example: AxExample;
    generatorOutput: AxACEGeneratorOutput;
    feedback?: string;
  }>): Promise<AxACEReflectionOutput | undefined> {
    const reflector = this.getOrCreateReflectorProgram();
    const reflectorAI = this.teacherAI ?? this.studentAI;

    try {
      const expectedAnswer = {
        severity: (example as { severity?: string })?.severity,
        policyHint: (example as { policyHint?: string })?.policyHint,
      };
      const reflectionRaw = await reflector.forward(reflectorAI, {
        question: JSON.stringify(example),
        generator_answer: JSON.stringify(generatorOutput.answer),
        generator_reasoning: generatorOutput.reasoning,
        playbook: JSON.stringify({
          markdown: renderPlaybook(this.playbook),
          structured: this.playbook,
        }),
        expected_answer:
          expectedAnswer.severity || expectedAnswer.policyHint
            ? JSON.stringify(expectedAnswer)
            : undefined,
        feedback,
      });
      return reflectionRaw as AxACEReflectionOutput;
    } catch (error) {
      if (this.verbose) {
        console.warn(
          '[AxACE] Reflector error:',
          error instanceof Error ? error.message : error
        );
      }
      return undefined;
    }
  }

  private async runCurator({
    example,
    reflection,
    playbook,
  }: Readonly<{
    example: AxExample;
    reflection?: AxACEReflectionOutput;
    playbook: AxACEPlaybook;
  }>): Promise<AxACECuratorOutput | undefined> {
    if (!reflection) {
      return undefined;
    }

    const curator = this.getOrCreateCuratorProgram();
    const curatorAI = this.teacherAI ?? this.studentAI;

    try {
      const outputRaw = await curator.forward(curatorAI, {
        playbook: JSON.stringify({
          markdown: renderPlaybook(playbook),
          structured: playbook,
        }),
        reflection: JSON.stringify(reflection),
        question_context: JSON.stringify(example),
        token_budget: 1024,
      });

      return outputRaw as AxACECuratorOutput;
    } catch (error) {
      if (this.verbose) {
        console.warn(
          '[AxACE] Curator error:',
          error instanceof Error ? error.message : error
        );
      }
      return undefined;
    }
  }

  private getOrCreateReflectorProgram(): AxGen<any, any> {
    if (!this.reflectorProgram) {
      const signature = f()
        .input('question', f.string('Original task input serialized as JSON'))
        .input(
          'generator_answer',
          f.string('Generator output serialized as JSON')
        )
        .input(
          'generator_reasoning',
          f.string('Generator reasoning trace').optional()
        )
        .input(
          'playbook',
          f.string('Current context playbook rendered as markdown')
        )
        .input(
          'expected_answer',
          f.string('Expected output when ground truth is available').optional()
        )
        .input(
          'feedback',
          f.string('External feedback or reward signal').optional()
        )
        .output(
          'reasoning',
          f.string('Step-by-step analysis of generator performance')
        )
        .output('errorIdentification', f.string('Specific mistakes detected'))
        .output('rootCauseAnalysis', f.string('Underlying cause of the error'))
        .output(
          'correctApproach',
          f.string('What the generator should do differently')
        )
        .output('keyInsight', f.string('Reusable insight to remember'))
        .output(
          'bulletTags',
          f.json('Array of {id, tag} entries referencing playbook bullets')
        )
        .build();
      this.reflectorProgram = ax(signature);
    }
    return this.reflectorProgram;
  }

  private getOrCreateCuratorProgram(): AxGen<any, any> {
    if (!this.curatorProgram) {
      const signature = f()
        .input('playbook', f.string('Current playbook serialized as JSON'))
        .input(
          'reflection',
          f.string('Latest reflection output serialized as JSON')
        )
        .input(
          'question_context',
          f.string('Original task input serialized as JSON')
        )
        .input(
          'token_budget',
          f.number('Approximate token budget for curator response').optional()
        )
        .output('reasoning', f.string('Justification for the proposed updates'))
        .output(
          'operations',
          f.json('List of operations with type/section/content fields')
        )
        .build();
      this.curatorProgram = ax(signature);
    }
    return this.curatorProgram;
  }
}
