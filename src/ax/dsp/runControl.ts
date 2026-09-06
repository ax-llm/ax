import type { AxAIServiceOptions } from '../ai/types.js';

export type AxRunUpdate = {
  id: number;
  target: string;
} & (
  | { type: 'steer'; text: string }
  | {
      type: 'thinking';
      level: NonNullable<AxAIServiceOptions['thinkingTokenBudget']>;
    }
);
export type AxRunControlEvent = {
  type:
    | 'queued'
    | 'applied'
    | 'started'
    | 'completed'
    | 'failed'
    | 'aborted'
    | 'model.output'
    | 'tool.started'
    | 'tool.completed';
  path: string;
  updateId?: number;
  callId?: string;
  pendingCallIds?: readonly string[];
  timing?: 'native' | 'next-response';
  error?: unknown;
};

/** A controller can be shared by a root run and its descendants. */
export class AxRunControl {
  private readonly controller = new AbortController();
  private readonly updates: AxRunUpdate[] = [];
  private readonly listeners = new Set<(event: AxRunControlEvent) => void>();
  private readonly wakeListeners = new Set<() => void>();
  private nextId = 0;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  steer(text: string, options?: { target?: string }): void {
    if (!text.trim()) throw new Error('Steering text must not be empty');
    this.enqueue({
      type: 'steer',
      text,
      target: options?.target ?? 'root',
      id: ++this.nextId,
    });
  }

  setThinkingTokenBudget(
    level: NonNullable<AxAIServiceOptions['thinkingTokenBudget']>,
    options?: { target?: string }
  ): void {
    this.enqueue({
      type: 'thinking',
      level,
      target: options?.target ?? 'root',
      id: ++this.nextId,
    });
  }

  abort(): void {
    if (this.signal.aborted) return;
    this.controller.abort(new Error('Run aborted by controller'));
    this.emit({ type: 'aborted', path: 'root' });
  }

  onEvent(listener: (event: AxRunControlEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @internal */
  pending(path: string, after: number): readonly AxRunUpdate[] {
    return this.updates.filter(
      (u) =>
        u.id > after && (path === u.target || path.startsWith(`${u.target}/`))
    );
  }

  /** @internal */
  subscribe(listener: () => void): () => void {
    this.wakeListeners.add(listener);
    return () => {
      this.wakeListeners.delete(listener);
    };
  }

  /** @internal */
  emit(event: AxRunControlEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  private enqueue(update: AxRunUpdate): void {
    if (this.signal.aborted) throw new Error('Run controller is aborted');
    this.updates.push(update);
    this.emit({ type: 'queued', path: update.target, updateId: update.id });
    for (const listener of this.wakeListeners) listener();
  }
}

export const runControl = (): AxRunControl => new AxRunControl();
