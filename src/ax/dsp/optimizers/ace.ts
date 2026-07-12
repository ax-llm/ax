import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxOptimizationStats,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import type { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  type AxOptimizedProgram,
  AxOptimizedProgramImpl,
  type AxOptimizerResult,
} from '../optimizer.js';
import { type AxField, f } from '../sig.js';
import { ax } from '../template.js';
import type { AxGenOut } from '../types.js';
import {
  applyCuratorOperations,
  clonePlaybook,
  createEmptyPlaybook,
  dedupePlaybookByContent,
  renderPlaybook,
  updateBulletFeedback,
} from './acePlaybook.js';
import type {
  AxACEBullet,
  AxACECuratorOperation,
  AxACECuratorOutput,
  AxACEFeedbackEvent,
  AxACEGeneratorOutput,
  AxACEOptimizationArtifact,
  AxACEOptions,
  AxACEPlaybook,
  AxACEReflectionOutput,
} from './aceTypes.js';

interface AxACECompileOptions extends AxCompileOptions {
  aceOptions?: AxACEOptions;
}

function cloneSerializable<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function cloneArtifact(
  artifact: Readonly<AxACEOptimizationArtifact>
): AxACEOptimizationArtifact {
  return {
    playbook: clonePlaybook(artifact.playbook),
    feedback: cloneSerializable(artifact.feedback),
    history: cloneSerializable(artifact.history),
  };
}

// --- Curator output discipline ----------------------------------------------
// The curator (an LLM sub-program) sometimes emits ADD operations whose content
// is a no-op acknowledgment of its own decision ("No update required.", "Keep
// the existing routing rule unchanged.", "The escalation rule remains correct.")
// instead of a reusable rule. Those bullets pollute the rendered playbook, so we
// drop them deterministically before they ever become bullets. The exact same
// logic is mirrored into AxIR (`@ace_is_noop_acknowledgment` in
// ir/axcore/optimize.axir) so every generated-language port filters identically;
// keep the two in lockstep when editing these lists.

// "no <subject>" needs a "<qualifier>" to count as a no-op so that legitimate
// prohibition rules ("No change to the schema without a migration.", "No new
// dependencies without review.") are NOT dropped.
const ACE_NOOP_SUBJECTS = [
  'no update',
  'no updates',
  'no change',
  'no changes',
  'no modification',
  'no modifications',
  'no edit',
  'no edits',
  'no revision',
  'no revisions',
  'no action',
  'no adjustment',
  'no adjustments',
  'no new',
  'no additional',
  'no further',
];
const ACE_NOOP_QUALIFIERS = ['needed', 'required', 'necessary', 'warranted'];

// Standalone markers that are never a real rule.
const ACE_NOOP_MARKERS = ['no-op', 'noop'];

// Inherently no-op phrasings, safe to match anywhere in the content.
const ACE_NOOP_PHRASES = [
  'nothing to add',
  'nothing to change',
  'nothing to update',
  'nothing to modify',
  'nothing to revise',
  'nothing needs',
  'nothing further',
];

// "keep/leave/retain/preserve the existing ... <stasis>" acknowledgments.
const ACE_NOOP_KEEP_PREFIXES = [
  'keep the existing',
  'leave the existing',
  'retain the existing',
  'preserve the existing',
];
const ACE_NOOP_STASIS = ['unchanged', 'as is', 'as-is', 'intact', 'in place'];

// "<referent> ... remains <stasis>" acknowledgments (e.g. "the existing rule
// remains correct"). Gated on a playbook-referent word so generic guidance such
// as "ensure the output remains correct" survives.
const ACE_NOOP_REMAINS = [
  'remains correct',
  'remains unchanged',
  'remains the same',
  'remains valid',
  'remains accurate',
  'already correct',
];
const ACE_NOOP_REFERENTS = [
  'existing',
  'current',
  'rule',
  'guideline',
  'guidance',
  'playbook',
  'bullet',
  'entry',
];

/**
 * True when an ADD operation's content is a no-op acknowledgment rather than a
 * substantive, reusable rule. Deterministic and case-insensitive. Mirrored by
 * the AxIR op `@ace_is_noop_acknowledgment`.
 */
export function isAceNoOpAcknowledgment(content: string): boolean {
  const c = content.toLowerCase().trim();
  if (c.length === 0) {
    return false;
  }

  // Standalone markers.
  for (const marker of ACE_NOOP_MARKERS) {
    if (c.startsWith(marker)) {
      return true;
    }
  }

  // "no <subject>" + "<qualifier>".
  let hasSubject = false;
  for (const subject of ACE_NOOP_SUBJECTS) {
    if (c.includes(subject)) {
      hasSubject = true;
      break;
    }
  }
  if (hasSubject) {
    for (const qualifier of ACE_NOOP_QUALIFIERS) {
      if (c.includes(qualifier)) {
        return true;
      }
    }
  }

  // "nothing to <action>" / "nothing needs ...".
  for (const phrase of ACE_NOOP_PHRASES) {
    if (c.includes(phrase)) {
      return true;
    }
  }

  // "keep/leave/retain/preserve the existing ... <stasis>".
  let hasKeepPrefix = false;
  for (const keepPrefix of ACE_NOOP_KEEP_PREFIXES) {
    if (c.startsWith(keepPrefix)) {
      hasKeepPrefix = true;
      break;
    }
  }
  if (hasKeepPrefix) {
    for (const stasis of ACE_NOOP_STASIS) {
      if (c.includes(stasis)) {
        return true;
      }
    }
  }

  // "<referent> ... remains <stasis>".
  let hasRemains = false;
  for (const remains of ACE_NOOP_REMAINS) {
    if (c.includes(remains)) {
      hasRemains = true;
      break;
    }
  }
  if (hasRemains) {
    for (const referent of ACE_NOOP_REFERENTS) {
      if (c.includes(referent)) {
        return true;
      }
    }
  }

  return false;
}

const DEFAULT_CONFIG: Required<
  Pick<
    AxACEOptions,
    | 'maxEpochs'
    | 'maxReflectorRounds'
    | 'maxSectionSize'
    | 'maxSerializedFieldChars'
    | 'similarityThreshold'
    | 'allowDynamicSections'
  >
> = {
  maxEpochs: 1,
  maxReflectorRounds: 2,
  maxSectionSize: 25,
  maxSerializedFieldChars: 2000,
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
 * The reflector's `bulletTags` field is model-produced JSON: models sometimes
 * emit a single object (or junk) where the schema asks for an array. Guard
 * the shape here, once, so the `for...of` consumers (tag application, curator
 * target resolution) never throw mid-update. Exported for testing.
 */
export function normalizeReflectionBulletTags(
  reflection: AxACEReflectionOutput | undefined
): AxACEReflectionOutput | undefined {
  if (!reflection || reflection.bulletTags === undefined) {
    return reflection;
  }
  const raw = reflection.bulletTags as unknown;
  const candidates = Array.isArray(raw) ? raw : [raw];
  const bulletTags = candidates.filter(
    (tag): tag is AxACEReflectionOutput['bulletTags'][number] =>
      !!tag &&
      typeof tag === 'object' &&
      typeof (tag as { id?: unknown }).id === 'string' &&
      typeof (tag as { tag?: unknown }).tag === 'string'
  );
  return { ...reflection, bulletTags };
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
    demos?: AxOptimizedProgram<OUT>['demos'];
    examples?: AxExample[];
    modelConfig?: AxOptimizedProgram<OUT>['modelConfig'];
    scoreHistory?: number[];
    configurationHistory?: Record<string, unknown>[];
  }) {
    super({
      bestScore: config.bestScore,
      stats: config.stats,
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
    this.artifact = cloneArtifact(config.artifact);
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
  private baseInstruction?: string;
  private generatorHistory: AxACEFeedbackEvent[] = [];
  private deltaHistory: AxACEOptimizationArtifact['history'] = [];

  private reflectorProgram?: AxGen<any, any>;

  private curatorProgram?: AxGen<any, any>;

  private program?: Readonly<AxGen<any, any>>;

  constructor(
    args: Readonly<AxOptimizerArgs>,
    options?: Readonly<AxACEOptions>
  ) {
    super(args);

    // Only let explicitly-set option values override the defaults. A caller (e.g.
    // the playbook() wrapper) may pass keys with `undefined` values for knobs the
    // user did not set; a plain spread would let that `undefined` clobber the
    // default (e.g. maxReflectorRounds -> undefined => the reflector never runs).
    const definedOptions = Object.fromEntries(
      Object.entries(options ?? {}).filter(([, value]) => value !== undefined)
    ) as Partial<AxACEOptions>;
    this.aceConfig = {
      ...DEFAULT_CONFIG,
      ...definedOptions,
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
    this.baseInstruction = undefined;
    this.generatorHistory = [];
    this.deltaHistory = [];
  }

  public hydrate<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    state?: Readonly<{
      baseInstruction?: string;
      playbook?: AxACEPlaybook;
      artifact?: Partial<AxACEOptimizationArtifact>;
    }>
  ): void {
    this.program = program as Readonly<AxGen<any, any>>;
    this.baseInstruction =
      state?.baseInstruction ??
      program.getSignature().getDescription() ??
      undefined;
    this.playbook =
      state?.playbook !== undefined
        ? clonePlaybook(state.playbook)
        : this.aceConfig.initialPlaybook !== undefined
          ? clonePlaybook(this.aceConfig.initialPlaybook)
          : createEmptyPlaybook();
    this.generatorHistory = cloneSerializable(state?.artifact?.feedback ?? []);
    this.deltaHistory = cloneSerializable(state?.artifact?.history ?? []);
  }

  public getPlaybook(): AxACEPlaybook {
    return clonePlaybook(this.playbook);
  }

  public getBaseInstruction(): string | undefined {
    return this.baseInstruction;
  }

  public getArtifact(): AxACEOptimizationArtifact {
    return this.createArtifact();
  }

  public applyCurrentState<IN, OUT extends AxGenOut>(
    program?: AxGen<IN, OUT>
  ): void {
    const target = (program ?? this.program) as AxGen<IN, OUT> | undefined;
    if (!target) {
      throw new Error('AxACE: no program available to apply playbook state');
    }

    const baseInstruction =
      this.baseInstruction ?? target.getSignature().getDescription() ?? '';
    (target as any).setDescription?.(
      this.composeInstruction(baseInstruction, this.playbook)
    );
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
        maxSerializedFieldChars:
          aceOptions.maxSerializedFieldChars ??
          this.aceConfig.maxSerializedFieldChars,
        similarityThreshold:
          aceOptions.similarityThreshold ?? this.aceConfig.similarityThreshold,
        allowDynamicSections:
          aceOptions.allowDynamicSections ??
          this.aceConfig.allowDynamicSections,
      });
    }

    const startTime = Date.now();
    this.validateExamples(examples);

    super.reset();
    this.playbook =
      aceOptions?.initialPlaybook !== undefined
        ? clonePlaybook(aceOptions.initialPlaybook)
        : this.aceConfig.initialPlaybook !== undefined
          ? clonePlaybook(this.aceConfig.initialPlaybook)
          : createEmptyPlaybook();
    this.program = program;

    const baseInstruction = await this.extractProgramInstruction(program);
    const originalDescription = program.getSignature().getDescription() ?? '';
    this.baseInstruction = baseInstruction ?? originalDescription;

    this.generatorHistory = [];
    this.deltaHistory = [];

    let bestScore = Number.NEGATIVE_INFINITY;
    let round = 0;

    const epochs = Math.max(this.aceConfig.maxEpochs, 1);
    const totalRoundsTarget = epochs * examples.length;

    try {
      for (let epoch = 0; epoch < epochs; epoch++) {
        for (let index = 0; index < examples.length; index++) {
          const example = examples[index]!;

          // Compose prompt with current playbook
          const composedInstruction = this.composeInstruction(
            baseInstruction ?? originalDescription,
            this.playbook
          );
          (program as any).setDescription?.(composedInstruction);

          const prediction = await program.forward(
            this.studentAI,
            example as IN
          );
          this.stats.totalCalls += 1;

          const score = await metricFn({
            prediction,
            example: example as AxExample,
          });

          if (typeof score === 'number') {
            this.stats.bestScore = Math.max(this.stats.bestScore, score);
            bestScore = Math.max(bestScore, score);
          }

          const generatorOutput = this.createGeneratorOutput(
            prediction,
            example,
            program
          );

          const reflection = await this.runReflectionRounds({
            example,
            generatorOutput,
            feedback: this.createMetricFeedback(score),
          });

          const rawCurator = await this.runCurator({
            program,
            example,
            reflection,
            playbook: this.playbook,
          });

          const operations = this.normalizeCuratorOperations(
            rawCurator?.operations
          );
          const resolvedOperations = this.resolveCuratorOperationTargets(
            operations,
            this.playbook,
            reflection,
            generatorOutput
          );

          const curatorResult =
            rawCurator || resolvedOperations.length > 0
              ? ({
                  ...(rawCurator ?? {}),
                  operations: resolvedOperations,
                } as AxACECuratorOutput)
              : undefined;

          let appliedDeltaIds: string[] = [];
          if (resolvedOperations.length > 0) {
            const protectedIds =
              this.collectProtectedBulletIds(resolvedOperations);
            const applicationResult = applyCuratorOperations(
              this.playbook,
              resolvedOperations,
              {
                maxSectionSize: this.aceConfig.maxSectionSize,
                allowDynamicSections: this.aceConfig.allowDynamicSections,
                enableAutoPrune: true,
                protectedBulletIds: protectedIds,
              }
            );
            appliedDeltaIds = applicationResult.updatedBulletIds;
            if (applicationResult.autoRemoved.length > 0) {
              resolvedOperations.push(...applicationResult.autoRemoved);
              if (curatorResult) {
                curatorResult.operations = resolvedOperations;
              }
            }
          }

          if (reflection?.bulletTags) {
            for (const tag of reflection.bulletTags) {
              updateBulletFeedback(this.playbook, tag.id, tag.tag);
            }
          }

          if (resolvedOperations.length > 0 && appliedDeltaIds.length > 0) {
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
              source: 'compile',
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
            { epochs, totalRounds: totalRoundsTarget },
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
    } finally {
      (program as any).setDescription?.(originalDescription);
    }

    const optimizationTime = Date.now() - startTime;
    this.stats.resourceUsage.totalTime = optimizationTime;
    this.stats.convergenceInfo.converged = true;
    this.stats.bestScore = Number.isFinite(bestScore) ? bestScore : 0;

    const artifact = this.createArtifact();

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
    if (!this.program) {
      throw new Error(
        'AxACE: `compile` must be run before `applyOnlineUpdate`'
      );
    }

    const generatorOutput = this.createGeneratorOutput(
      args.prediction,
      args.example,
      this.program
    );

    const reflection = await this.runReflectionRounds({
      example: args.example,
      generatorOutput,
      feedback: args.feedback,
    });

    const rawCurator = await this.runCurator({
      program: this.program,
      example: args.example,
      reflection,
      playbook: this.playbook,
    });

    const operations = this.normalizeCuratorOperations(rawCurator?.operations);
    const resolvedOperations = this.resolveCuratorOperationTargets(
      operations,
      this.playbook,
      reflection,
      generatorOutput
    );

    const curatorResult =
      rawCurator || resolvedOperations.length > 0
        ? ({
            ...(rawCurator ?? {}),
            operations: resolvedOperations,
          } as AxACECuratorOutput)
        : undefined;

    if (reflection?.bulletTags) {
      for (const tag of reflection.bulletTags) {
        updateBulletFeedback(this.playbook, tag.id, tag.tag);
      }
    }

    let appliedDeltaIds: string[] = [];
    if (resolvedOperations.length > 0) {
      const protectedIds = this.collectProtectedBulletIds(resolvedOperations);
      const result = applyCuratorOperations(this.playbook, resolvedOperations, {
        maxSectionSize: this.aceConfig.maxSectionSize,
        allowDynamicSections: this.aceConfig.allowDynamicSections,
        enableAutoPrune: true,
        protectedBulletIds: protectedIds,
      });
      appliedDeltaIds = result.updatedBulletIds;
      if (result.autoRemoved.length > 0) {
        resolvedOperations.push(...result.autoRemoved);
        if (curatorResult) {
          curatorResult.operations = resolvedOperations;
        }
      }
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

    if (appliedDeltaIds.length > 0 && curatorResult?.operations?.length) {
      this.deltaHistory.push({
        source: 'online',
        epoch: -1,
        exampleIndex: this.generatorHistory.length - 1,
        operations: curatorResult.operations,
      });
    }

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

  private createArtifact(): AxACEOptimizationArtifact {
    return {
      playbook: clonePlaybook(this.playbook),
      feedback: cloneSerializable(this.generatorHistory),
      history: cloneSerializable(this.deltaHistory),
    };
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

  private createGeneratorOutput<IN, OUT extends AxGenOut>(
    prediction: unknown,
    example: AxTypedExample<IN>,
    program?: Readonly<AxGen<IN, OUT>>
  ): AxACEGeneratorOutput {
    const reasoning =
      (prediction as Record<string, unknown>)?.thought?.toString() ?? '';

    const bulletIds = Array.isArray(
      (prediction as Record<string, unknown>)?.bullet_ids
    )
      ? ((prediction as Record<string, unknown>)?.bullet_ids as string[])
      : [];

    const signature = program?.getSignature();
    const input = this.extractBoundedFieldValues(
      example as AxExample,
      signature?.getInputFields() ?? []
    );
    const expectedOutput = this.extractBoundedFieldValues(
      example as AxExample,
      signature?.getOutputFields() ?? []
    );
    const predictionOutput =
      prediction && typeof prediction === 'object'
        ? this.extractBoundedFieldValues(
            prediction as AxExample,
            signature?.getOutputFields() ?? []
          )
        : prediction;

    return {
      reasoning,
      answer: prediction,
      bulletIds,
      trajectory: this.stringifyBounded({
        input,
        expectedOutput,
        prediction: predictionOutput,
      }),
      metadata: {
        inputFields: Object.keys(input),
        outputFields: Object.keys(expectedOutput),
      },
    };
  }

  private createMetricFeedback(score: number): string | undefined {
    if (!Number.isFinite(score)) {
      return undefined;
    }
    return `Metric score: ${score}`;
  }

  private extractFieldValues(
    source: AxExample,
    fields: readonly AxField[]
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.hasOwn(source, field.name)) {
        values[field.name] = source[field.name];
      }
    }
    return values;
  }

  private extractBoundedFieldValues(
    source: AxExample,
    fields: readonly AxField[]
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.hasOwn(source, field.name)) {
        values[field.name] = this.boundSerializedFieldValue(source[field.name]);
      }
    }
    return values;
  }

  private createQuestionContext(
    example: AxExample,
    fields: readonly AxField[]
  ): Record<string, unknown> {
    return this.extractFieldValues(example, fields);
  }

  private createExpectedAnswer(
    example: AxExample,
    fields: readonly AxField[]
  ): Record<string, unknown> {
    return this.extractFieldValues(example, fields);
  }

  private stringifyBounded(value: unknown): string {
    try {
      return JSON.stringify(this.boundSerializedValue(value));
    } catch {
      return JSON.stringify('[Unserializable]');
    }
  }

  private boundSerializedValue(
    value: unknown,
    seen = new WeakSet<object>()
  ): unknown {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'string') {
      return this.truncateSerializedString(value);
    }

    if (typeof value !== 'object') {
      return this.truncateSerializedString(String(value));
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const result = value.map((entry) =>
        this.boundSerializedValue(entry, seen)
      );
      seen.delete(value);
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = this.boundSerializedValue(entry, seen);
    }
    seen.delete(value);
    return result;
  }

  private boundSerializedFieldValue(value: unknown): unknown {
    const boundedValue = this.boundSerializedValue(value);
    const serialized = JSON.stringify(boundedValue);
    const maxChars = Math.max(0, this.aceConfig.maxSerializedFieldChars);
    if (serialized.length <= maxChars) {
      return boundedValue;
    }
    return this.truncateSerializedString(serialized);
  }

  private truncateSerializedString(value: string): string {
    const maxChars = Math.max(0, this.aceConfig.maxSerializedFieldChars);
    if (value.length <= maxChars) {
      return value;
    }
    const suffix = '...[truncated]';
    if (maxChars <= suffix.length) {
      return value.slice(0, maxChars);
    }
    return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
  }

  private resolveCuratorOperationTargets(
    operations: AxACECuratorOperation[],
    playbook: AxACEPlaybook,
    reflection?: AxACEReflectionOutput,
    generatorOutput?: AxACEGeneratorOutput
  ): AxACECuratorOperation[] {
    if (!operations.length) {
      return operations;
    }

    const resolved: AxACECuratorOperation[] = [];
    const usedIds = new Set<string>(
      operations
        .map((op) => op.bulletId)
        .filter((id): id is string => typeof id === 'string')
    );

    interface SectionQueues {
      harmful: string[];
      primary: string[];
      generator: string[];
    }

    const sectionQueues = new Map<string, SectionQueues>();

    const enqueueCandidate = (
      bulletId: string,
      priority: keyof SectionQueues
    ): void => {
      if (usedIds.has(bulletId)) {
        return;
      }
      const located = this.locateBullet(playbook, bulletId);
      if (!located) {
        return;
      }
      const queues = sectionQueues.get(located.section) ?? {
        harmful: [],
        primary: [],
        generator: [],
      };
      queues[priority].push(located.id);
      sectionQueues.set(located.section, queues);
    };

    for (const tag of reflection?.bulletTags ?? []) {
      const priority = tag.tag === 'harmful' ? 'harmful' : 'primary';
      enqueueCandidate(tag.id, priority);
    }

    if (generatorOutput?.bulletIds) {
      for (const bulletId of generatorOutput.bulletIds) {
        enqueueCandidate(bulletId, 'generator');
      }
    }

    const dequeueForSection = (section: string): string | undefined => {
      const queues = sectionQueues.get(section);
      if (!queues) {
        return this.locateFallbackBullet(playbook, section, usedIds);
      }

      const shift = (list: string[]): string | undefined => {
        while (list.length > 0) {
          const candidate = list.shift()!;
          if (!usedIds.has(candidate)) {
            return candidate;
          }
        }
        return undefined;
      };

      const candidate =
        shift(queues.harmful) ??
        shift(queues.primary) ??
        shift(queues.generator);

      if (candidate) {
        return candidate;
      }

      return this.locateFallbackBullet(playbook, section, usedIds);
    };

    for (const operation of operations) {
      if (
        (operation.type === 'UPDATE' || operation.type === 'REMOVE') &&
        !operation.bulletId
      ) {
        const candidate = dequeueForSection(operation.section);
        if (candidate) {
          operation.bulletId = candidate;
          usedIds.add(candidate);
        }
      }

      if (
        (operation.type === 'UPDATE' || operation.type === 'REMOVE') &&
        !operation.bulletId
      ) {
        // No viable target; drop this operation.
        continue;
      }

      resolved.push(operation);
    }

    return resolved;
  }

  private locateBullet(
    playbook: AxACEPlaybook,
    bulletId: string
  ): AxACEBullet | undefined {
    for (const sectionBullets of Object.values(playbook.sections)) {
      const bullet = sectionBullets.find((entry) => entry.id === bulletId);
      if (bullet) {
        return bullet;
      }
    }
    return undefined;
  }

  private locateFallbackBullet(
    playbook: AxACEPlaybook,
    section: string,
    usedIds: ReadonlySet<string>
  ): string | undefined {
    const bullets = playbook.sections[section] ?? [];
    for (const bullet of bullets) {
      if (!usedIds.has(bullet.id)) {
        return bullet.id;
      }
    }
    return undefined;
  }

  private collectProtectedBulletIds(
    operations: readonly AxACECuratorOperation[]
  ): Set<string> {
    const protectedIds = new Set<string>();
    for (const operation of operations) {
      if (operation.type === 'UPDATE' && operation.bulletId) {
        protectedIds.add(operation.bulletId);
      }
    }
    return protectedIds;
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

        // Drop ADD operations whose content merely acknowledges that nothing
        // changed ("No update required.", "Keep the existing rule unchanged.")
        // so only substantive guidance becomes a bullet.
        if (type === 'ADD' && isAceNoOpAcknowledgment(content)) {
          continue;
        }

        const bulletIdRaw =
          (entry as { bulletId?: string }).bulletId ??
          (entry as { id?: string }).id;
        const bulletId =
          typeof bulletIdRaw === 'string' && bulletIdRaw.trim().length > 0
            ? bulletIdRaw.trim()
            : undefined;

        const keyParts = [type, section, content, bulletId ?? ''];
        const key = keyParts.join(':');
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
        if (bulletId) {
          normalizedEntry.bulletId = bulletId;
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

  private async runReflectionRounds({
    example,
    generatorOutput,
    feedback,
  }: Readonly<{
    example: AxExample;
    generatorOutput: AxACEGeneratorOutput;
    feedback?: string;
  }>): Promise<AxACEReflectionOutput | undefined> {
    const rounds = Math.max(this.aceConfig.maxReflectorRounds, 1);
    let previous: AxACEReflectionOutput | undefined;

    for (let round = 0; round < rounds; round++) {
      const reflection = await this.runReflector({
        example,
        generatorOutput,
        feedback,
        previousReflection: previous,
      });

      if (!reflection) {
        break;
      }

      previous = reflection;

      const errorText =
        reflection.errorIdentification?.toLowerCase().trim() ?? '';
      const resolved = (
        reflection.metadata as { resolved?: boolean } | undefined
      )?.resolved;

      if (
        resolved === true ||
        errorText.length === 0 ||
        errorText.startsWith('no error') ||
        errorText.startsWith('resolved')
      ) {
        break;
      }
    }

    return previous;
  }

  private async runReflector({
    example,
    generatorOutput,
    feedback,
    previousReflection,
  }: Readonly<{
    example: AxExample;
    generatorOutput: AxACEGeneratorOutput;
    feedback?: string;
    previousReflection?: AxACEReflectionOutput;
  }>): Promise<AxACEReflectionOutput | undefined> {
    const reflector = this.getOrCreateReflectorProgram();
    const reflectorAI = this.teacherAI ?? this.studentAI;

    try {
      const signature = this.program?.getSignature();
      const inputFields = signature?.getInputFields() ?? [];
      const outputFields = signature?.getOutputFields() ?? [];
      const questionContext = this.createQuestionContext(example, inputFields);
      const expectedAnswer = this.createExpectedAnswer(example, outputFields);

      const reflectionRaw = await reflector.forward(reflectorAI, {
        question: this.stringifyBounded(questionContext),
        generator_answer: this.stringifyBounded(generatorOutput.answer),
        generator_reasoning: generatorOutput.reasoning,
        playbook: JSON.stringify({
          markdown: renderPlaybook(this.playbook),
          structured: this.playbook,
        }),
        expected_answer:
          Object.keys(expectedAnswer).length > 0
            ? this.stringifyBounded(expectedAnswer)
            : undefined,
        feedback,
        previous_reflection: previousReflection
          ? JSON.stringify(previousReflection)
          : undefined,
      });
      return normalizeReflectionBulletTags(
        reflectionRaw as AxACEReflectionOutput
      );
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

  private async runCurator<IN, OUT extends AxGenOut>({
    program,
    example,
    reflection,
    playbook,
  }: Readonly<{
    program: Readonly<AxGen<IN, OUT>>;
    example: AxExample;
    reflection?: AxACEReflectionOutput;
    playbook: AxACEPlaybook;
  }>): Promise<AxACECuratorOutput | undefined> {
    if (!reflection) {
      return undefined;
    }

    const curator = this.getOrCreateCuratorProgram();
    const curatorAI = this.teacherAI ?? this.studentAI;

    const signature = program.getSignature();
    const inputFields = signature.getInputFields();
    const questionContext = this.createQuestionContext(example, inputFields);

    try {
      const outputRaw = await curator.forward(curatorAI, {
        playbook: JSON.stringify({
          markdown: renderPlaybook(playbook),
          structured: playbook,
        }),
        reflection: JSON.stringify(reflection),
        question_context: this.stringifyBounded(questionContext),
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
        .input(
          'previous_reflection',
          f
            .string(
              'Most recent reflection JSON when running multi-round refinement'
            )
            .optional()
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
          f.json(
            'List of operations, each {type: "ADD"|"UPDATE"|"REMOVE", section, content}. Emit an operation ONLY when the playbook should actually change. If nothing should change, return an empty array — never emit an ADD whose content just acknowledges that no change is needed (e.g. "No update required", "Keep the existing rule unchanged"). Each ADD content must be a standalone, reusable rule.'
          )
        )
        .build();
      this.curatorProgram = ax(signature);
    }
    return this.curatorProgram;
  }
}
