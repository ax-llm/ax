import type { extractionState } from './extract.js';

export interface AxStreamingGuard {
  fieldName: string;
  fn(
    content: string,
    done?: boolean
  ): Promise<boolean | string | undefined> | boolean | string | undefined;
  message?: string;
}

export class AxStreamingGuardError extends Error {
  constructor({
    message,
  }: Readonly<{
    message: string;
  }>) {
    super(message);
    this.name = 'AxStreamingGuardError';
  }

  override toString(): string {
    return `${this.name}: ${this.message}`;
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

export const checkStreamingGuards = async (
  guards: readonly AxStreamingGuard[],
  xstate: Readonly<extractionState>,
  content: string,
  final = false
) => {
  if (!xstate.currField || xstate.s === -1 || guards.length === 0) {
    return;
  }

  const fieldGuards = guards.filter(
    (guard) => guard.fieldName === xstate.currField?.name
  );

  if (fieldGuards.length === 0) {
    return;
  }

  const currValue = content.substring(xstate.s);

  for (const guard of fieldGuards) {
    const { message, fn } = guard;
    const res = await fn(currValue, final);

    if (res === undefined || res === true) {
      continue;
    }

    if (typeof res === 'string') {
      throw new AxStreamingGuardError({ message: res });
    }

    throw new AxStreamingGuardError({
      message:
        message ??
        `Streaming guard failed for field '${guard.fieldName}'. Output was stopped.`,
    });
  }
};
