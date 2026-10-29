import type { AxProgramTrace } from '../types.js';

/** Capture identities before forward(), including programs with mutable trace arrays. */
export function snapshotBootstrapTraces<IN, OUT>(
  before: readonly AxProgramTrace<IN, OUT>[]
): ReadonlyMap<string, ReadonlySet<unknown>> {
  const previous = new Map<string, Set<unknown>>();
  for (const { programId, trace } of before) {
    let traces = previous.get(programId);
    if (!traces) {
      traces = new Set();
      previous.set(programId, traces);
    }
    traces.add(trace);
  }
  return previous;
}

/** Keep traces emitted by this training run, excluding inactive child traces. */
export function freshBootstrapTraces<IN, OUT>(
  previous: ReadonlyMap<string, ReadonlySet<unknown>>,
  after: readonly AxProgramTrace<IN, OUT>[]
): AxProgramTrace<IN, OUT>[] {
  return after.filter(
    ({ programId, trace }) => !previous.get(programId)?.has(trace)
  );
}
