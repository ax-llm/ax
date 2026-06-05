import type { extractionState } from './extract.js';

export interface AxAssertion<T = Record<string, unknown>> {
  fn(
    values: T
  ): Promise<boolean | string | undefined> | boolean | string | undefined;
  message?: string;
}

export interface AxStreamingAssertion {
  fieldName: string;
  fn(
    content: string,
    done?: boolean
  ): Promise<boolean | string | undefined> | boolean | string | undefined;
  message?: string;
}

export class AxAssertionError extends Error {
  constructor({
    message,
  }: Readonly<{
    message: string;
  }>) {
    super(message);
    this.name = 'AxAssertionError';
  }

  public getFixingInstructions = () => {
    const message = this.message.trim();
    return [
      {
        name: 'error',
        title: 'Follow these instructions',
        description: message + (message.endsWith('.') ? '' : '.'),
      },
    ];
  };

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

export class AxStreamingAssertionError extends Error {
  constructor({
    message,
  }: Readonly<{
    message: string;
  }>) {
    super(message);
    this.name = 'AxStreamingAssertionError';
  }

  public getFixingInstructions = () => {
    const message = this.message.trim();
    return [
      {
        name: 'error',
        title: 'Follow these instructions',
        description: message + (message.endsWith('.') ? '' : '.'),
      },
    ];
  };

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

export const assertAssertions = async <T = Record<string, unknown>>(
  asserts: readonly AxAssertion<T>[],
  values: T
) => {
  for (const assert of asserts) {
    const { fn, message } = assert;
    const res = await fn(values);

    if (res === undefined || res === true) {
      continue;
    }

    if (typeof res === 'string') {
      throw new AxAssertionError({ message: res });
    }

    if (!message) {
      throw new Error('Assertion failed without message');
    }

    throw new AxAssertionError({ message });
  }
};

export const assertStreamingAssertions = async (
  asserts: readonly AxStreamingAssertion[],
  xstate: Readonly<extractionState>,
  content: string,
  final = false
) => {
  if (!xstate.currField || xstate.s === -1 || asserts.length === 0) {
    return;
  }

  const fieldAsserts = asserts.filter(
    (assert) => assert.fieldName === xstate.currField?.name
  );

  if (fieldAsserts.length === 0) {
    return;
  }

  const currValue = content.substring(xstate.s);

  for (const assert of fieldAsserts) {
    const { message, fn } = assert;
    const res = await fn(currValue, final);

    if (res === undefined || res === true) {
      continue;
    }

    if (typeof res === 'string') {
      throw new AxStreamingAssertionError({ message: res });
    }

    throw new AxStreamingAssertionError({
      message:
        message ??
        `Streaming assertion failed for field '${assert.fieldName}'. Output was stopped.`,
    });
  }
};
