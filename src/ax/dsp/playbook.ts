import type { AxAIService } from '../ai/types.js';
import type { AxExample, AxMetricFn, AxTypedExample } from './common_types.js';
import type { AxGen } from './generate.js';
import { AxACE } from './optimizers/ace.js';
import { renderPlaybook } from './optimizers/acePlaybook.js';
import type {
  AxACEOptimizationArtifact,
  AxACEPlaybook,
} from './optimizers/aceTypes.js';
import type { AxGenOut } from './types.js';

/**
 * Options for {@link playbook}.
 *
 * A playbook grows an evolving body of task knowledge ("context engineering")
 * and renders it into a program's context. The underlying evolution engine is
 * an implementation detail (currently ACE — the Agentic Context Engineering
 * loop) and is intentionally absent from this surface, mirroring how
 * {@link optimize} hides its optimizer.
 */
export type AxPlaybookOptions = {
  /** Model that runs the program while the playbook is grown. */
  studentAI: AxAIService;
  /** Model used to reflect on rollouts and curate the playbook. Defaults to studentAI. */
  teacherAI?: AxAIService;
  verbose?: boolean;
  seed?: number;
  /** Max passes over the dataset during {@link AxPlaybook.evolve}. */
  maxEpochs?: number;
  /** Max reflection refinement rounds per example. */
  maxReflectorRounds?: number;
  /** Max bullets per section before pruning kicks in. */
  maxSectionSize?: number;
  /** Allow the playbook to grow new sections on its own. */
  allowDynamicSections?: boolean;
  /** Seed the playbook with existing content. */
  initialPlaybook?: AxACEPlaybook;
  /** Intensity preset applied at construction. */
  auto?: 'light' | 'medium' | 'heavy';
};

/**
 * A serializable snapshot of a playbook's content and history. Persist with
 * {@link AxPlaybook.toJSON} and restore with {@link AxPlaybook.load}.
 */
export type AxPlaybookSnapshot = {
  playbook: AxACEPlaybook;
  artifact: AxACEOptimizationArtifact;
};

/** Result of {@link AxPlaybook.evolve}: the best score reached and the resulting playbook. */
export type AxPlaybookEvolveResult = {
  bestScore: number;
  playbook: AxACEPlaybook;
};

/** Per-run overrides for a single {@link AxPlaybook.evolve} call. */
export type AxPlaybookEvolveOptions = {
  maxEpochs?: number;
  auto?: 'light' | 'medium' | 'heavy';
};

/**
 * A live, evolving context playbook bound to a program.
 *
 * Grow it offline from examples ({@link evolve}), keep it growing online from
 * live feedback ({@link update}), render it into the program's context
 * ({@link applyTo}), and persist/restore it ({@link toJSON}/{@link load}).
 *
 * Construct via the {@link playbook} factory.
 */
export class AxPlaybook<IN = any, OUT extends AxGenOut = AxGenOut> {
  private readonly program: Readonly<AxGen<IN, OUT>>;
  private readonly engine: AxACE;
  private readonly baseInstruction: string | undefined;
  private started = false;
  private applyHook?: (rendered: string) => void;

  constructor(
    program: Readonly<AxGen<IN, OUT>>,
    options: Readonly<AxPlaybookOptions>
  ) {
    this.program = program;
    this.engine = new AxACE(
      {
        studentAI: options.studentAI,
        teacherAI: options.teacherAI,
        verbose: options.verbose,
        seed: options.seed,
      },
      {
        maxEpochs: options.maxEpochs,
        maxReflectorRounds: options.maxReflectorRounds,
        maxSectionSize: options.maxSectionSize,
        allowDynamicSections: options.allowDynamicSections,
        initialPlaybook: options.initialPlaybook,
      }
    );
    if (options.auto) {
      this.engine.configureAuto(options.auto);
    }
    this.baseInstruction = program.getSignature().getDescription() ?? undefined;
  }

  /**
   * Grow the playbook offline from labeled examples, scoring each rollout with
   * `metricFn`, then render the result into the bound program.
   */
  public async evolve(
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: Readonly<AxPlaybookEvolveOptions>
  ): Promise<AxPlaybookEvolveResult> {
    if (options?.auto) {
      this.engine.configureAuto(options.auto);
    }
    const result = await this.engine.compile(this.program, examples, metricFn, {
      aceOptions: { maxEpochs: options?.maxEpochs },
    });
    this.started = true;
    this.inject();
    return { bestScore: result.bestScore, playbook: result.playbook };
  }

  /**
   * Refine the playbook online from a single live interaction. Safe to call
   * without a prior {@link evolve}/{@link load} — the bound program is hydrated
   * lazily on first use.
   */
  public async update(
    args: Readonly<{
      example: AxExample;
      prediction: unknown;
      feedback?: string;
    }>
  ): Promise<void> {
    if (!this.started) {
      this.engine.hydrate(this.program, {
        baseInstruction: this.baseInstruction,
        playbook: this.engine.getPlaybook(),
      });
      this.started = true;
    }
    await this.engine.applyOnlineUpdate(args);
    this.inject();
  }

  /** Render the current playbook into a program's context (defaults to the bound program). */
  public applyTo(program?: Readonly<AxGen<IN, OUT>>): void {
    if (program && program !== this.program) {
      this.engine.applyCurrentState(program as AxGen<IN, OUT>);
      return;
    }
    this.inject();
  }

  /** The current playbook rendered as a markdown block. */
  public render(): string {
    return renderPlaybook(this.engine.getPlaybook());
  }

  /** A serializable snapshot of the current playbook and its history. */
  public getState(): AxPlaybookSnapshot {
    return {
      playbook: this.engine.getPlaybook(),
      artifact: this.engine.getArtifact(),
    };
  }

  /** Alias of {@link getState} so `JSON.stringify(handle)` yields a snapshot. */
  public toJSON(): AxPlaybookSnapshot {
    return this.getState();
  }

  /** Restore a snapshot into this handle and render it into the bound program. */
  public load(snapshot: Readonly<AxPlaybookSnapshot>): this {
    this.engine.hydrate(this.program, {
      baseInstruction: this.baseInstruction,
      playbook: snapshot.playbook,
      artifact: snapshot.artifact,
    });
    this.started = true;
    this.inject();
    return this;
  }

  /** Set the evolution intensity preset. */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    this.engine.configureAuto(level);
  }

  /** Clear the playbook back to its initial state. */
  public reset(): void {
    this.engine.reset();
    this.started = false;
  }

  /**
   * @internal Redirect playbook injection. Used by `agent.playbook()` to push
   * the rendered playbook into a pipeline stage instead of a bare program.
   */
  public _setApplyHook(hook: (rendered: string) => void): void {
    this.applyHook = hook;
  }

  private inject(): void {
    if (this.applyHook) {
      this.applyHook(this.render());
      return;
    }
    this.engine.applyCurrentState(this.program as AxGen<IN, OUT>);
  }
}

/**
 * Create an evolving context {@link AxPlaybook} for a program.
 *
 * A playbook accumulates task knowledge and renders it into the program's
 * context: grow it offline from examples ({@link AxPlaybook.evolve}), keep it
 * growing online from live feedback ({@link AxPlaybook.update}), and
 * persist/restore it ({@link AxPlaybook.toJSON}/{@link AxPlaybook.load}). The
 * evolution engine is an implementation detail and never appears on this
 * surface.
 */
export function playbook<IN = any, OUT extends AxGenOut = AxGenOut>(
  program: Readonly<AxGen<IN, OUT>>,
  options: Readonly<AxPlaybookOptions>
): AxPlaybook<IN, OUT> {
  return new AxPlaybook(program, options);
}
