import { formatInterpreterOutput } from '../runtime.js';

function fitObservationText(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (text.length <= budget) return text;
  return budget <= 3
    ? text.slice(0, budget)
    : `${text.slice(0, budget - 3)}...`;
}

/** Cap long previews equally after satisfying shorter ones, in any result order. */
function allocatePreviewSpace(needs: number[], budget: number): number[] {
  const sorted = needs
    .map((need, index) => ({ need, index }))
    .sort((a, b) => a.need - b.need);
  const allocations = new Array<number>(needs.length);
  let remaining = Math.max(0, budget);
  for (const [position, { need, index }] of sorted.entries()) {
    const share = Math.floor(remaining / (sorted.length - position));
    allocations[index] = Math.min(need, share);
    remaining -= allocations[index]!;
  }
  return allocations;
}

/** Share space across structure instead of allowing its first field to consume it. */
function formatObservationValue(
  value: unknown,
  budget: number,
  prepared?: string,
  preferCompact = false
): string {
  if (value === null || typeof value !== 'object') {
    return fitObservationText(
      prepared ?? formatInterpreterOutput(value, budget),
      budget
    );
  }
  const active = new WeakSet<object>();
  const scalar = (text: string, available: number): string => {
    if (text.length <= available) return text;
    // Keep truncation explicit and syntactically complete. Empty values after
    // object keys look like broken data and erase small but important fields.
    if (available < 3) return fitObservationText('…', available);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    if (typeof value !== 'string') return '"…"';
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (JSON.stringify(`${value.slice(0, middle)}…`).length <= available)
        low = middle;
      else high = middle - 1;
    }
    return JSON.stringify(`${value.slice(0, low)}…`);
  };
  const compact = (value: unknown): string | undefined => {
    try {
      // Stop sizing once the value cannot fit. Serializing an entire large
      // runtime array just to choose a small preview defeats external storage.
      let size = 0;
      let root = true;
      return JSON.stringify(value, function (key, item) {
        const converted = typeof item === 'bigint' ? String(item) : item;
        // Bound traversal by a lower bound on serialized size. The first
        // member of each container has no comma, and JSON omits some keys.
        const omitted =
          converted === undefined ||
          typeof converted === 'function' ||
          typeof converted === 'symbol';
        if (omitted && !Array.isArray(this)) return converted;
        if (!root && !Array.isArray(this)) size += key.length + 3;
        root = false;
        size +=
          typeof converted === 'string'
            ? converted.length + 2
            : converted !== null && typeof converted === 'object'
              ? 2
              : omitted ||
                  (typeof converted === 'number' && !Number.isFinite(converted))
                ? 4 // null in JSON
                : String(converted).length;
        if (size > budget) throw new Error('Preview sizing budget reached');
        return converted;
      });
    } catch {
      return undefined;
    }
  };
  const visit = (
    current: unknown,
    available: number,
    depth: number
  ): string => {
    if (available <= 0) return '';
    if (current === null || typeof current !== 'object')
      return scalar(
        compact(current) ??
          JSON.stringify(
            typeof current === 'string' && current.length > available
              ? `${current.slice(0, available)}…`
              : String(current)
          ),
        available
      );
    if (active.has(current)) return scalar('"[Circular]"', available);
    const full = compact(current);
    if (full !== undefined && full.length <= available) {
      if (preferCompact) return full;
      const pretty = JSON.stringify(JSON.parse(full), null, 2);
      return pretty.length <= available ? pretty : full;
    }
    if (depth >= 6)
      return scalar(
        JSON.stringify(
          Array.isArray(current) ? `[Array(${current.length})]` : '[Object]'
        ),
        available
      );
    active.add(current);
    try {
      const array = Array.isArray(current);
      let fields: [string, unknown][];
      if (array) {
        const values =
          current.length <= 6
            ? current
            : [
                ...current.slice(0, 3),
                `[${current.length - 5} more items]`,
                ...current.slice(-2),
              ];
        fields = values.map((item) => ['', item]);
      } else {
        const keys = Object.keys(current);
        const selected =
          keys.length <= 12 ? keys : [...keys.slice(0, 6), ...keys.slice(-5)];
        fields = selected.map((key) => [
          `${JSON.stringify(key)}:`,
          (current as Record<string, unknown>)[key],
        ]);
        if (selected.length < keys.length)
          fields.splice(6, 0, [
            '"…":',
            `[${keys.length - selected.length} more fields]`,
          ]);
      }
      const overhead =
        2 +
        Math.max(0, fields.length - 1) +
        fields.reduce((sum, [key]) => sum + key.length, 0);
      const space = available - overhead;
      if (space < fields.length * 3)
        return scalar(
          JSON.stringify(
            array
              ? `[Array(${current.length})]`
              : '[Object: inspect saved value]'
          ),
          available
        );
      // Water-fill the budget: short values retain their full contents, leaving
      // unused space for nested data instead of allocating every field equally.
      const needs = fields.map(([, item]) =>
        Math.max(3, compact(item)?.length ?? space)
      );
      const allocations = allocatePreviewSpace(needs, space);
      const rendered = fields
        .map(
          ([key, item], index) =>
            `${key}${visit(item, allocations[index]!, depth + 1)}`
        )
        .join(',');
      return array ? `[${rendered}]` : `{${rendered}}`;
    } finally {
      active.delete(current);
    }
  };
  try {
    return visit(value, budget, 0);
  } catch {
    return fitObservationText(
      prepared ?? formatInterpreterOutput(value, budget),
      budget
    );
  }
}

/** A pause for model interpretation, not a failed tool call. */
class ObservationRequired extends Error {
  constructor() {
    super('Read the new observations before choosing another action.');
    this.name = 'AxAgentObservationRequired';
  }
}

/** Shared by all host entry points for one actor execution. */
export class TurnObservations {
  private generation = 0;
  private results: { name: string; value: unknown }[] = [];
  private discovery = false;
  private blocked = false;
  private blockedAction?: string;
  private pending = new Map<
    Promise<void>,
    { name: string; finish: () => void }
  >();

  captureGeneration(): number {
    return this.generation;
  }

  hasObservations(): boolean {
    return this.discovery || this.results.length > 0;
  }

  invalidate(): void {
    this.generation++;
    this.reset();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const { finish } of pending) finish();
  }

  reset(): void {
    this.results = [];
    this.discovery = false;
    this.blocked = false;
    this.blockedAction = undefined;
  }

  wasBlocked(): boolean {
    return this.blocked;
  }

  assertCanAct(currentHandler?: string, attemptedAction?: string): void {
    if (
      this.discovery ||
      this.results.length > 0 ||
      [...this.pending.values()].some(({ name }) => name !== currentHandler)
    ) {
      this.blocked = true;
      this.blockedAction ??= attemptedAction;
      throw new ObservationRequired();
    }
  }

  recordResult(
    name: string,
    value: unknown,
    generation = this.generation
  ): void {
    if (generation !== this.generation) return;
    this.results.push({ name, value });
  }

  /** Keep inspection calls without await from being overtaken by another action. */
  beginCall(name: string): () => void {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.pending.set(pending, { name, finish });
    return () => {
      this.pending.delete(pending);
      finish();
    };
  }

  async waitForPending(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        Promise.all(this.pending.keys()),
        new Promise<never>((_resolve, reject) => {
          if (!signal) return;
          onAbort = () => reject(signal.reason ?? new Error('Aborted'));
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  finishDiscovery(generation = this.generation): void {
    if (generation !== this.generation) return;
    this.discovery = true;
    this.blocked = true;
    throw new ObservationRequired();
  }

  isPause(error: unknown): boolean {
    return (
      this.blocked &&
      (error instanceof ObservationRequired ||
        (error instanceof Error &&
          error.name === 'AxAgentObservationRequired') ||
        /^AxAgentObservationRequired(?::|\n|$)/.test(String(error)))
    );
  }

  render(maxChars: number, output = '', isError = false): string {
    const limit = Math.max(0, Math.floor(maxChars));
    const fit = fitObservationText;
    if (!this.discovery && this.results.length === 0) return fit(output, limit);

    const resultTexts = this.results.map(({ value }) =>
      formatObservationValue(value, limit, undefined, this.results.length > 1)
    );
    const printed = output.trim();
    const matchesOutput = (texts: string[]) =>
      texts.some((text) => text.trim() === printed) ||
      texts.join('\n').trim() === printed;
    // Batch sizing uses compact JSON. The program can print the same object
    // as indented JSON, which should not claim a second share of the budget.
    const duplicate =
      !isError &&
      !!printed &&
      (matchesOutput(resultTexts) ||
        (this.results.length > 1 &&
          printed.includes('\n') &&
          matchesOutput(
            this.results.map(({ value }) =>
              formatObservationValue(value, limit)
            )
          )));
    const additionalOutput =
      duplicate || output === '(no output)' ? '' : output;
    // Keep observations visible even when the code prints large amounts of
    // unrelated output. Errors and useful projections still get a bounded share.
    const outputReserve = additionalOutput
      ? Math.min(additionalOutput.length, Math.floor(limit / 3))
      : 0;
    const observationBudget = Math.max(
      0,
      limit - outputReserve - (outputReserve > 0 ? 1 : 0)
    );
    const header =
      this.blocked && !this.discovery
        ? `[OBSERVATION] Execution paused${this.blockedAction ? ` before ${this.blockedAction}` : ''}. The blocked call and later statements did not execute. Read the results above, then continue from saved variables. Do not rerun the original block.`
        : '[OBSERVATION] Review completed results. Reuse assigned values; blocked calls did not run.';
    const discoveryNote = this.discovery
      ? 'Discovery completed. Dependent tool calls did not execute. Read the new docs, skills, or memories and issue needed calls next turn.'
      : '';
    const metadata = [discoveryNote, header].filter(Boolean).join('\n');
    const entryBudget = Math.max(
      0,
      observationBudget - metadata.length - (this.results.length > 0 ? 1 : 0)
    );
    const allocations = allocatePreviewSpace(
      this.results.map(
        ({ name }, index) => name.length + 2 + resultTexts[index]!.length
      ),
      entryBudget - Math.max(0, this.results.length - 1)
    );
    const entries = this.results.map(({ name, value }, index) => {
      const perEntryBudget = allocations[index]!;
      const prefix = `${name}: `;
      const budget = Math.max(0, perEntryBudget - prefix.length);
      const prepared = resultTexts[index]!;
      const preview =
        prepared.length <= budget
          ? prepared
          : formatObservationValue(value, budget, prepared);
      return fit(prefix + preview, perEntryBudget);
    });
    // When the requested budget cannot fit metadata, evidence still comes first.
    const evidence =
      entryBudget > 0
        ? entries.filter(Boolean).join('\n')
        : this.results
            .map(({ name }, index) => `${name}: ${resultTexts[index]}`)
            .join('\n');
    const observationText = fit(
      [evidence, metadata].filter(Boolean).join('\n'),
      observationBudget
    );
    const remaining = Math.max(0, limit - observationText.length - 1);
    return [observationText, fit(additionalOutput, remaining)]
      .filter(Boolean)
      .join('\n');
  }
}
