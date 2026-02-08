import type { AxAIServiceOptions, AxModelConfig } from '../ai/types.js';
import type { AxInputFunctionType } from './functions.js';
import type {
  AxFunctionCallRecord,
  AxStepContext,
  AxStepUsage,
} from './types.js';

/**
 * Internal implementation of AxStepContext.
 * Uses a pending mutations pattern: mutations are collected during a step
 * and consumed/applied at the next step boundary.
 */
export class AxStepContextImpl implements AxStepContext {
  // Read-only state
  private _stepIndex = 0;
  readonly maxSteps: number;
  private _functionsExecuted = new Set<string>();
  private _lastFunctionCalls: AxFunctionCallRecord[] = [];
  private _usage: AxStepUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // Custom state map (persists across steps)
  readonly state = new Map<string, unknown>();

  // Pending mutations
  private _pendingOptions: Partial<
    AxAIServiceOptions & {
      modelConfig?: Partial<AxModelConfig>;
      model?: string;
    }
  > = {};
  private _functionsToAdd: AxInputFunctionType = [];
  private _functionsToRemove: string[] = [];
  private _stopRequested = false;
  private _stopResultValues?: Record<string, unknown>;

  constructor(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  // === Read-only accessors ===

  get stepIndex(): number {
    return this._stepIndex;
  }

  get isFirstStep(): boolean {
    return this._stepIndex === 0;
  }

  get functionsExecuted(): ReadonlySet<string> {
    return this._functionsExecuted;
  }

  get lastFunctionCalls(): readonly AxFunctionCallRecord[] {
    return this._lastFunctionCalls;
  }

  get usage(): Readonly<AxStepUsage> {
    return this._usage;
  }

  // === Mutators (collect pending mutations) ===

  setModel(model: string): void {
    this._pendingOptions.model = model;
  }

  setThinkingBudget(budget: AxAIServiceOptions['thinkingTokenBudget']): void {
    this._pendingOptions.thinkingTokenBudget = budget;
  }

  setTemperature(temperature: number): void {
    if (!this._pendingOptions.modelConfig) {
      this._pendingOptions.modelConfig = {};
    }
    this._pendingOptions.modelConfig.temperature = temperature;
  }

  setMaxTokens(maxTokens: number): void {
    if (!this._pendingOptions.modelConfig) {
      this._pendingOptions.modelConfig = {};
    }
    this._pendingOptions.modelConfig.maxTokens = maxTokens;
  }

  setOptions(
    options: Partial<
      AxAIServiceOptions & { modelConfig?: Partial<AxModelConfig> }
    >
  ): void {
    Object.assign(this._pendingOptions, options);
  }

  addFunctions(functions: AxInputFunctionType): void {
    this._functionsToAdd.push(...functions);
  }

  removeFunctions(...names: string[]): void {
    this._functionsToRemove.push(...names);
  }

  stop(resultValues?: Record<string, unknown>): void {
    this._stopRequested = true;
    this._stopResultValues = resultValues;
  }

  // === Internal methods (used by the loop) ===

  /** Reset per-step state at the beginning of a new step. */
  _beginStep(stepIndex: number): void {
    this._stepIndex = stepIndex;
    this._functionsExecuted = new Set<string>();
    this._lastFunctionCalls = [];
  }

  /** Record a function call that was executed during this step. */
  _recordFunctionCall(name: string, args: unknown, result: unknown): void {
    this._functionsExecuted.add(name.toLowerCase());
    this._lastFunctionCalls.push({ name, args, result });
  }

  /** Accumulate token usage from a completed step. */
  _addUsage(
    promptTokens: number,
    completionTokens: number,
    totalTokens: number
  ): void {
    this._usage.promptTokens += promptTokens;
    this._usage.completionTokens += completionTokens;
    this._usage.totalTokens += totalTokens;
  }

  /** Consume and clear pending options. Returns undefined if no pending options. */
  _consumePendingOptions():
    | Partial<
        AxAIServiceOptions & {
          modelConfig?: Partial<AxModelConfig>;
          model?: string;
        }
      >
    | undefined {
    if (Object.keys(this._pendingOptions).length === 0) {
      return undefined;
    }
    const opts = this._pendingOptions;
    this._pendingOptions = {};
    return opts;
  }

  /** Consume and clear pending functions to add. */
  _consumeFunctionsToAdd(): AxInputFunctionType | undefined {
    if (this._functionsToAdd.length === 0) {
      return undefined;
    }
    const fns = this._functionsToAdd;
    this._functionsToAdd = [];
    return fns;
  }

  /** Consume and clear pending function names to remove. */
  _consumeFunctionsToRemove(): string[] | undefined {
    if (this._functionsToRemove.length === 0) {
      return undefined;
    }
    const names = this._functionsToRemove;
    this._functionsToRemove = [];
    return names;
  }

  /** Check if stop was requested. */
  get _isStopRequested(): boolean {
    return this._stopRequested;
  }

  /** Get stop result values if any. */
  get _stopValues(): Record<string, unknown> | undefined {
    return this._stopResultValues;
  }
}
