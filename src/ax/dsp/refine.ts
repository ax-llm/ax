import type { AxAIService, AxModelConfig } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';
import { AxGen } from './generate.js';
import type { AxOptimizableComponent } from './optimizable.js';
import type { AxOptimizedProgram } from './optimizer.js';
import type { AxSignature } from './sig.js';
import type {
  AxAgentUsage,
  AxChatLogEntry,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramStreamingForwardOptions,
  AxProgramTrace,
  AxProgramUsage,
} from './types.js';
import { mergeProgramUsage } from './util.js';

export type AxRefineStrategy = 'auto' | 'native-samples' | 'serial';

export type AxRewardFnArgs<IN, OUT extends AxGenOut> = {
  input: Readonly<IN>;
  prediction: Readonly<OUT>;
  attempt: number;
  round: number;
  sampleIndex: number;
  traces: readonly AxProgramTrace<IN, OUT>[];
  chatLog: readonly AxChatLogEntry[];
};

export type AxRewardFn<IN, OUT extends AxGenOut> = (
  args: Readonly<AxRewardFnArgs<IN, OUT>>
) => number | Promise<number>;

export type AxAttempt<IN, OUT extends AxGenOut> = {
  attempt: number;
  round: number;
  sampleIndex: number;
  strategy: Exclude<AxRefineStrategy, 'auto'>;
  input: IN;
  prediction?: OUT;
  reward?: number;
  metThreshold: boolean;
  traces: AxProgramTrace<IN, OUT>[];
  chatLog: AxChatLogEntry[];
  usage: AxProgramUsage[];
  error?: unknown;
  advice?: Record<string, string>;
  adviceApplied?: boolean;
};

export type AxBestOfNOptions<IN, OUT extends AxGenOut> = {
  n: number;
  rewardFn: AxRewardFn<IN, OUT>;
  threshold?: number;
  failCount?: number;
  modelConfig?: Partial<AxModelConfig>;
  strategy?: AxRefineStrategy;
  onAttempt?: (attempt: Readonly<AxAttempt<IN, OUT>>) => void | Promise<void>;
};

export type AxRefineOptions<IN, OUT extends AxGenOut> = {
  rounds: number;
  samplesPerRound?: number;
  rewardFn: AxRewardFn<IN, OUT>;
  threshold?: number;
  failCount?: number;
  modelConfig?: Partial<AxModelConfig>;
  strategy?: AxRefineStrategy;
  feedbackAI?: Readonly<AxAIService>;
  feedbackModelConfig?: Partial<AxModelConfig>;
  rewardDescription?: string;
  programDescription?: string;
  onAttempt?: (attempt: Readonly<AxAttempt<IN, OUT>>) => void | Promise<void>;
};

type FeedbackInput = {
  programDescription: string;
  programInput: string;
  failedPrediction: string;
  rewardValue: number;
  rewardThreshold: string;
  attemptSummaries: string;
  instructionComponents: string;
  rewardDescription: string;
  traceSummary: string;
  chatSummary: string;
};

type FeedbackOutput = {
  summary?: string;
  advice: Record<string, string>;
};

type RunBatchArgs<IN> = {
  ai: Readonly<AxAIService>;
  input: IN;
  forwardOptions?: Readonly<AxProgramForwardOptions<any>>;
  count: number;
  round: number;
  failCount: number;
  strategy: Exclude<AxRefineStrategy, 'auto'>;
  threshold?: number;
};

let refineSessionCounter = 0;

const nextSessionId = (prefix: string) => {
  refineSessionCounter++;
  return `${prefix}-${Date.now()}-${refineSessionCounter}`;
};

const normalizeCount = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(value);
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, inner) => {
      if (typeof inner === 'bigint') return inner.toString();
      if (typeof inner === 'function')
        return `[Function ${inner.name || 'anonymous'}]`;
      return inner;
    });
  } catch {
    return String(value);
  }
};

const mergeModelConfig = (
  base?: Partial<AxModelConfig>,
  override?: AxModelConfig
): AxModelConfig => ({
  temperature: 1,
  ...base,
  ...override,
});

const selectedStrategyFor = <IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  strategy?: AxRefineStrategy
): Exclude<AxRefineStrategy, 'auto'> => {
  if (strategy === 'serial') return 'serial';
  if (strategy === 'native-samples') {
    if (!(program instanceof AxGen)) {
      throw new AxRefineError(
        'strategy "native-samples" requires an AxGen program'
      );
    }
    return 'native-samples';
  }
  return program instanceof AxGen ? 'native-samples' : 'serial';
};

const getTraceSlice = <IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  start: number
) => program.getTraces().slice(start) as AxProgramTrace<IN, OUT>[];

const getChatLogSlice = (
  program: Readonly<AxProgrammable<any, any>>,
  start: number
) => program.getChatLog().slice(start) as AxChatLogEntry[];

const flattenUsage = (
  usage: AxProgramUsage[] | AxAgentUsage
): AxProgramUsage[] =>
  Array.isArray(usage) ? usage : [...usage.actor, ...usage.responder];

export class AxRefineError extends Error {
  public readonly attempts: readonly AxAttempt<any, any>[];

  constructor(message: string, attempts: readonly AxAttempt<any, any>[] = []) {
    super(message);
    this.name = 'AxRefineError';
    this.attempts = attempts;
  }
}

abstract class AxRefineBase<IN, OUT extends AxGenOut>
  implements AxProgrammable<IN, OUT>
{
  protected abstract readonly modelConfig?: Partial<AxModelConfig>;
  protected abstract readonly rewardFn: AxRewardFn<IN, OUT>;

  protected attempts: AxAttempt<IN, OUT>[] = [];
  protected selectedAttempt?: AxAttempt<IN, OUT>;

  constructor(protected readonly program: Readonly<AxProgrammable<IN, OUT>>) {}

  public abstract forward(
    ai: Readonly<AxAIService>,
    input: IN,
    options?: Readonly<AxProgramForwardOptions<any>>
  ): Promise<OUT>;

  public getAttempts(): readonly AxAttempt<IN, OUT>[] {
    return this.attempts;
  }

  public getSignature(): AxSignature {
    return this.program.getSignature();
  }

  public getId(): string {
    return this.program.getId();
  }

  public setId(id: string): void {
    this.program.setId(id);
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    return this.selectedAttempt?.traces ?? [];
  }

  public namedProgramInstances(): AxNamedProgramInstance<any, any>[] {
    return this.program.namedProgramInstances?.() ?? [];
  }

  public setDemos(
    demos: readonly AxProgramDemos<IN, OUT>[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    this.program.setDemos(demos, options);
  }

  public applyOptimization(optimizedProgram: AxOptimizedProgram<OUT>): void {
    this.program.applyOptimization(optimizedProgram);
  }

  public getOptimizableComponents(): readonly AxOptimizableComponent[] {
    return this.program.getOptimizableComponents();
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.program.applyOptimizedComponents(updates);
  }

  public getUsage(): AxProgramUsage[] {
    return mergeProgramUsage(this.attempts.flatMap((attempt) => attempt.usage));
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.selectedAttempt?.chatLog ?? [];
  }

  public resetUsage(): void {
    this.attempts = [];
    this.selectedAttempt = undefined;
    this.program.resetUsage();
  }

  public streamingForward(
    _ai: Readonly<AxAIService>,
    _values: IN,
    _options?: Readonly<AxProgramStreamingForwardOptions<any>>
  ): AxGenStreamingOut<OUT> {
    const error = new AxRefineError(
      'bestOfN/refine wrappers do not support streamingForward(); use forward() so complete candidates can be scored.'
    );
    return {
      async next() {
        throw error;
      },
      async return() {
        return { done: true, value: undefined };
      },
      async throw(thrown?: unknown) {
        throw thrown ?? error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      async [Symbol.asyncDispose]() {},
    } as AxGenStreamingOut<OUT>;
  }

  protected resetRun(): void {
    this.attempts = [];
    this.selectedAttempt = undefined;
  }

  protected async emitAttempt(
    onAttempt: AxBestOfNOptions<IN, OUT>['onAttempt'] | undefined,
    attempt: AxAttempt<IN, OUT>
  ) {
    this.attempts.push(attempt);
    await onAttempt?.(attempt);
  }

  protected async runCandidateBatch({
    ai,
    input,
    forwardOptions,
    count,
    round,
    failCount,
    strategy,
    threshold,
  }: RunBatchArgs<IN>): Promise<AxAttempt<IN, OUT>[]> {
    if (strategy === 'native-samples') {
      return this.runNativeSampleBatch({
        ai,
        input,
        forwardOptions,
        count,
        round,
        failCount,
        threshold,
      });
    }
    return this.runSerialBatch({
      ai,
      input,
      forwardOptions,
      count,
      round,
      failCount,
      threshold,
    });
  }

  private async runNativeSampleBatch({
    ai,
    input,
    forwardOptions,
    count,
    round,
    failCount,
    threshold,
  }: Omit<RunBatchArgs<IN>, 'strategy'>) {
    const attempts: AxAttempt<IN, OUT>[] = [];
    const traceStart = this.program.getTraces().length;
    const chatStart = this.program.getChatLog().length;
    this.program.resetUsage();
    let selectedIndex = 0;
    let bestReward = Number.NEGATIVE_INFINITY;

    let result: OUT;
    try {
      result = await this.program.forward(ai, input, {
        ...forwardOptions,
        mem: new AxMemory(),
        sessionId: nextSessionId('ax-refine-native'),
        sampleCount: count,
        modelConfig: {
          ...mergeModelConfig(this.modelConfig, forwardOptions?.modelConfig),
          stream: false,
        },
        resultPicker: async (data) => {
          if (data.type !== 'fields') {
            return 0;
          }

          const firstThresholdIndex =
            threshold === undefined ? undefined : { index: -1 };

          for (const item of data.results) {
            const prediction = item.sample as OUT;
            const attempt: AxAttempt<IN, OUT> = {
              attempt: this.attempts.length + attempts.length + 1,
              round,
              sampleIndex: item.index,
              strategy: 'native-samples',
              input,
              prediction,
              traces: [],
              chatLog: [],
              usage: [],
              reward: await this.rewardFn({
                input,
                prediction,
                attempt: this.attempts.length + attempts.length + 1,
                round,
                sampleIndex: item.index,
                traces: [],
                chatLog: [],
              }),
              metThreshold: false,
            };
            attempt.metThreshold =
              threshold !== undefined && attempt.reward! >= threshold;

            if (attempt.reward! > bestReward) {
              bestReward = attempt.reward!;
              selectedIndex = item.index;
            }
            if (
              firstThresholdIndex &&
              firstThresholdIndex.index === -1 &&
              attempt.metThreshold
            ) {
              firstThresholdIndex.index = item.index;
            }
            attempts.push(attempt);
          }

          if (firstThresholdIndex && firstThresholdIndex.index >= 0) {
            selectedIndex = firstThresholdIndex.index;
          }
          return selectedIndex;
        },
      });
    } catch (error) {
      const failureCount =
        this.attempts.filter((attempt) => attempt.error !== undefined).length +
        1;
      const attempt: AxAttempt<IN, OUT> = {
        attempt: this.attempts.length + 1,
        round,
        sampleIndex: 0,
        strategy: 'native-samples',
        input,
        metThreshold: false,
        traces: getTraceSlice(this.program, traceStart),
        chatLog: getChatLogSlice(this.program, chatStart),
        usage: flattenUsage(this.program.getUsage()),
        error,
      };
      if (failureCount > failCount) {
        throw new AxRefineError('Native sample attempt failed', [
          ...this.attempts,
          attempt,
        ]);
      }
      return [attempt];
    }

    const traces = getTraceSlice(this.program, traceStart);
    const chatLog = getChatLogSlice(this.program, chatStart);
    const usage = flattenUsage(this.program.getUsage());

    if (attempts.length === 0) {
      const attemptNumber = this.attempts.length + 1;
      const reward = await this.rewardFn({
        input,
        prediction: result,
        attempt: attemptNumber,
        round,
        sampleIndex: 0,
        traces,
        chatLog,
      });
      attempts.push({
        attempt: attemptNumber,
        round,
        sampleIndex: 0,
        strategy: 'native-samples',
        input,
        prediction: result,
        traces,
        chatLog,
        usage,
        reward,
        metThreshold: threshold !== undefined && reward >= threshold,
      });
      return attempts;
    }

    const selectedAttempt =
      attempts.find((attempt) => attempt.sampleIndex === selectedIndex) ??
      attempts[0];

    if (selectedAttempt) {
      selectedAttempt.prediction = result;
      selectedAttempt.traces = traces;
      selectedAttempt.chatLog = chatLog;
      selectedAttempt.usage = usage;
    }
    return attempts;
  }

  private async runSerialBatch({
    ai,
    input,
    forwardOptions,
    count,
    round,
    failCount,
    threshold,
  }: Omit<RunBatchArgs<IN>, 'strategy'>) {
    const attempts: AxAttempt<IN, OUT>[] = [];
    let failures = this.attempts.filter(
      (attempt) => attempt.error !== undefined
    ).length;

    for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
      const attemptNumber = this.attempts.length + attempts.length + 1;
      const traceStart = this.program.getTraces().length;
      const chatStart = this.program.getChatLog().length;
      this.program.resetUsage();
      try {
        const prediction = await this.program.forward(ai, input, {
          ...forwardOptions,
          mem: new AxMemory(),
          sessionId: nextSessionId('ax-refine-serial'),
          modelConfig: mergeModelConfig(
            this.modelConfig,
            forwardOptions?.modelConfig
          ),
        });
        const traces = getTraceSlice(this.program, traceStart);
        const chatLog = getChatLogSlice(this.program, chatStart);
        const reward = await this.rewardFn({
          input,
          prediction,
          attempt: attemptNumber,
          round,
          sampleIndex,
          traces,
          chatLog,
        });
        const attempt: AxAttempt<IN, OUT> = {
          attempt: attemptNumber,
          round,
          sampleIndex,
          strategy: 'serial',
          input,
          prediction,
          reward,
          metThreshold: threshold !== undefined && reward >= threshold,
          traces,
          chatLog,
          usage: flattenUsage(this.program.getUsage()),
        };
        attempts.push(attempt);
        if (attempt.metThreshold) break;
      } catch (error) {
        failures++;
        const attempt: AxAttempt<IN, OUT> = {
          attempt: attemptNumber,
          round,
          sampleIndex,
          strategy: 'serial',
          input,
          metThreshold: false,
          traces: getTraceSlice(this.program, traceStart),
          chatLog: getChatLogSlice(this.program, chatStart),
          usage: flattenUsage(this.program.getUsage()),
          error,
        };
        attempts.push(attempt);
        if (failures > failCount) {
          throw new AxRefineError(
            `Refine attempt failed after ${failures} failures`,
            [...this.attempts, ...attempts]
          );
        }
      }
    }

    return attempts;
  }

  protected selectBest(attempts: readonly AxAttempt<IN, OUT>[]) {
    const successful = attempts.filter(
      (
        attempt
      ): attempt is AxAttempt<IN, OUT> & {
        prediction: OUT;
        reward: number;
      } =>
        attempt.prediction !== undefined && typeof attempt.reward === 'number'
    );
    if (successful.length === 0) return undefined;
    return successful.reduce((best, attempt) =>
      attempt.reward > best.reward ? attempt : best
    );
  }

  protected firstThreshold(attempts: readonly AxAttempt<IN, OUT>[]) {
    return attempts.find(
      (attempt) => attempt.prediction !== undefined && attempt.metThreshold
    );
  }
}

export class AxBestOfN<IN, OUT extends AxGenOut> extends AxRefineBase<IN, OUT> {
  private readonly n: number;
  private readonly failCount: number;
  private readonly threshold?: number;
  private readonly strategy?: AxRefineStrategy;
  protected readonly modelConfig?: Partial<AxModelConfig>;
  protected readonly rewardFn: AxRewardFn<IN, OUT>;
  private readonly onAttempt?: AxBestOfNOptions<IN, OUT>['onAttempt'];

  constructor(
    program: Readonly<AxProgrammable<IN, OUT>>,
    options: Readonly<AxBestOfNOptions<IN, OUT>>
  ) {
    super(program);
    this.n = normalizeCount(options.n, 'n');
    this.failCount = Math.floor(options.failCount ?? this.n);
    this.threshold = options.threshold;
    this.strategy = options.strategy;
    this.modelConfig = options.modelConfig;
    this.rewardFn = options.rewardFn;
    this.onAttempt = options.onAttempt;
  }

  public async forward(
    ai: Readonly<AxAIService>,
    input: IN,
    options?: Readonly<AxProgramForwardOptions<any>>
  ): Promise<OUT> {
    this.resetRun();
    const strategy = selectedStrategyFor(this.program, this.strategy);
    const batch = await this.runCandidateBatch({
      ai,
      input,
      forwardOptions: options,
      count: this.n,
      round: 1,
      failCount: this.failCount,
      strategy,
      threshold: this.threshold,
    });
    for (const attempt of batch)
      await this.emitAttempt(this.onAttempt, attempt);

    const selected =
      this.firstThreshold(this.attempts) ?? this.selectBest(this.attempts);
    if (!selected?.prediction) {
      throw new AxRefineError(
        'bestOfN produced no successful candidates',
        this.attempts
      );
    }
    this.selectedAttempt = selected;
    return selected.prediction;
  }
}

export class AxRefine<IN, OUT extends AxGenOut> extends AxRefineBase<IN, OUT> {
  private readonly rounds: number;
  private readonly samplesPerRound: number;
  private readonly failCount: number;
  private readonly threshold?: number;
  private readonly strategy?: AxRefineStrategy;
  protected readonly modelConfig?: Partial<AxModelConfig>;
  protected readonly rewardFn: AxRewardFn<IN, OUT>;
  private readonly feedbackAI?: Readonly<AxAIService>;
  private readonly feedbackModelConfig?: Partial<AxModelConfig>;
  private readonly rewardDescription?: string;
  private readonly programDescription?: string;
  private readonly onAttempt?: AxRefineOptions<IN, OUT>['onAttempt'];

  constructor(
    program: Readonly<AxProgrammable<IN, OUT>>,
    options: Readonly<AxRefineOptions<IN, OUT>>
  ) {
    super(program);
    this.rounds = normalizeCount(options.rounds, 'rounds');
    this.samplesPerRound = normalizeCount(
      options.samplesPerRound ?? 1,
      'samplesPerRound'
    );
    this.failCount = Math.floor(
      options.failCount ?? this.rounds * this.samplesPerRound
    );
    this.threshold = options.threshold;
    this.strategy = options.strategy;
    this.modelConfig = options.modelConfig;
    this.rewardFn = options.rewardFn;
    this.feedbackAI = options.feedbackAI;
    this.feedbackModelConfig = options.feedbackModelConfig;
    this.rewardDescription = options.rewardDescription;
    this.programDescription = options.programDescription;
    this.onAttempt = options.onAttempt;
  }

  public async forward(
    ai: Readonly<AxAIService>,
    input: IN,
    options?: Readonly<AxProgramForwardOptions<any>>
  ): Promise<OUT> {
    this.resetRun();
    const originals = this.captureInstructionComponents();
    let best: AxAttempt<IN, OUT> | undefined;

    try {
      for (let round = 1; round <= this.rounds; round++) {
        const strategy = selectedStrategyFor(this.program, this.strategy);
        const batch = await this.runCandidateBatch({
          ai,
          input,
          forwardOptions: options,
          count: this.samplesPerRound,
          round,
          failCount: this.failCount,
          strategy,
          threshold: this.threshold,
        });

        for (const attempt of batch) {
          await this.emitAttempt(this.onAttempt, attempt);
        }

        const thresholdHit = this.firstThreshold(batch);
        if (thresholdHit?.prediction) {
          this.selectedAttempt = thresholdHit;
          return thresholdHit.prediction;
        }

        const roundBest = this.selectBest(batch);
        if (
          roundBest &&
          (!best ||
            roundBest.reward! > (best.reward ?? Number.NEGATIVE_INFINITY))
        ) {
          best = roundBest;
        }

        if (round < this.rounds && roundBest?.prediction) {
          const advice = await this.generateAdvice(
            ai,
            input,
            roundBest,
            originals
          );
          const applied = this.applyAdvice(advice, originals);
          roundBest.advice = advice;
          roundBest.adviceApplied = applied;
        }
      }

      if (!best?.prediction) {
        throw new AxRefineError(
          'refine produced no successful candidates',
          this.attempts
        );
      }
      this.selectedAttempt = best;
      return best.prediction;
    } finally {
      this.restoreInstructionComponents(originals);
    }
  }

  private captureInstructionComponents() {
    const components = this.program
      .getOptimizableComponents()
      .filter((component) => component.kind === 'instruction');
    return new Map(
      components.map((component) => [component.key, component.current])
    );
  }

  private applyAdvice(
    advice: Readonly<Record<string, string>>,
    originals: ReadonlyMap<string, string>
  ): boolean {
    const updates: Record<string, string> = {};
    for (const [key, current] of originals) {
      const value = advice[key]?.trim();
      if (!value) continue;
      updates[key] =
        `${current}\n\nRefinement advice from previous attempt:\n${value}`.trim();
    }
    if (Object.keys(updates).length === 0) return false;
    this.program.applyOptimizedComponents(updates);
    return true;
  }

  private restoreInstructionComponents(originals: ReadonlyMap<string, string>) {
    if (originals.size === 0) return;
    this.program.applyOptimizedComponents(Object.fromEntries(originals));
  }

  private async generateAdvice(
    ai: Readonly<AxAIService>,
    input: IN,
    attempt: AxAttempt<IN, OUT>,
    originals: ReadonlyMap<string, string>
  ): Promise<Record<string, string>> {
    if (originals.size === 0) return {};

    const feedbackGen = new AxGen<FeedbackInput, FeedbackOutput>(
      'programDescription:string, programInput:string, failedPrediction:string, rewardValue:number, rewardThreshold:string, attemptSummaries:string, instructionComponents:string, rewardDescription:string, traceSummary:string, chatSummary:string -> summary:string, advice:json'
    );
    feedbackGen.setInstruction(
      'Generate concrete, actionable advice for the listed instruction component keys. Return advice as a JSON object whose keys exactly match component keys and whose values are short instructions for the next attempt.'
    );

    const out = await feedbackGen.forward(
      this.feedbackAI ?? ai,
      {
        programDescription:
          this.programDescription ?? this.program.getSignature().toString(),
        programInput: safeStringify(input),
        failedPrediction: safeStringify(attempt.prediction),
        rewardValue: attempt.reward ?? 0,
        rewardThreshold:
          this.threshold === undefined
            ? 'not specified'
            : String(this.threshold),
        attemptSummaries: safeStringify(this.attempts),
        instructionComponents: safeStringify(
          [...originals].map(([key, current]) => ({ key, current }))
        ),
        rewardDescription:
          this.rewardDescription ?? String(this.rewardFn).slice(0, 2000),
        traceSummary: safeStringify(attempt.traces),
        chatSummary: safeStringify(attempt.chatLog),
      },
      {
        modelConfig: this.feedbackModelConfig as AxModelConfig | undefined,
      }
    );

    const advice = out.advice;
    if (!advice || typeof advice !== 'object') return {};
    return Object.fromEntries(
      Object.entries(advice)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
        .map(([key, value]) => [key, value])
    );
  }
}

export function bestOfN<IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  options: Readonly<AxBestOfNOptions<IN, OUT>>
): AxBestOfN<IN, OUT> {
  return new AxBestOfN(program, options);
}

export function refine<IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  options: Readonly<AxRefineOptions<IN, OUT>>
): AxRefine<IN, OUT> {
  return new AxRefine(program, options);
}
