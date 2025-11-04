import type { extractionState } from './extract.js';

export interface AxAssertion<T = Record<string, unknown>> {
  fn(
    values: T
  ): Promise<boolean | string | undefined> | boolean | string | undefined;
  message?: string;
}

export interface AxStreamingAssertion {
  fieldName: string;
  fn(content: string, done?: boolean): boolean | string | undefined;
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
    const extraFields = [];
    const message = this.message.trim();

    extraFields.push({
      name: 'error',
      title: 'Follow these instructions',
      description: message + (message.endsWith('.') ? '' : '.'),
    });

    return extraFields;
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
    if (res === undefined) {
      continue;
    }

    // Handle string returns as failures with custom message
    if (typeof res === 'string') {
      throw new AxAssertionError({ message: res });
    }

    // Handle boolean returns
    if (!res) {
      if (!message) {
        throw new Error('Assertion Failed: No message provided for assertion');
      }
      throw new AxAssertionError({ message });
    }
  }
};

export const assertStreamingAssertions = async (
  asserts: readonly AxStreamingAssertion[],
  xstate: Readonly<extractionState>,
  content: string,
  final = false
) => {
  if (
    !xstate.currField ||
    xstate.s === -1 ||
    !asserts ||
    asserts.length === 0
  ) {
    return;
  }

  const fieldAsserts = asserts.filter(
    (a) => a.fieldName === xstate.currField?.name
  );

  if (fieldAsserts.length === 0) {
    return;
  }

  const currValue = content.substring(xstate.s);

  for (const assert of fieldAsserts) {
    const { message, fn } = assert;

    const res = await fn(currValue, final);
    if (res === undefined) {
      continue;
    }

    // Handle string returns as failures with custom message
    if (typeof res === 'string') {
      throw new AxAssertionError({ message: res });
    }

    // Handle boolean returns
    if (!res && message) {
      throw new AxAssertionError({ message });
    }
  }
};
