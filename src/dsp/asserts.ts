import type { extractionState } from './extract.js';
import type { Signature } from './sig.js';

export interface Assertion {
  fn(values: Record<string, unknown>): boolean | undefined;
  message?: string;
  optional?: boolean;
}

export interface StreamingAssertion {
  fieldName: string;
  fn(content: string): boolean | undefined;
  message?: string;
  optional?: boolean;
}

export class AssertionError extends Error {
  private values: Record<string, unknown>;
  private optional?: boolean;

  constructor({
    message,
    values,
    optional
  }: Readonly<{
    message: string;
    values: Record<string, unknown>;
    optional?: boolean;
  }>) {
    super(message);
    this.values = values;
    this.optional = optional;
    this.name = this.constructor.name;
    this.stack = new Error().stack;
  }
  public getValue = () => this.values;
  public getOptional = () => this.optional;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getFixingInstructions = (_sig: Readonly<Signature>) => {
    const extraFields = [];

    // for (const f of sig.getOutputFields()) {
    //   extraFields.push({
    //     name: `past_${f.name}`,
    //     title: `Past ${f.title}`,
    //     description: JSON.stringify(this.values[f.name])
    //   });
    // }

    extraFields.push({
      name: 'instructions',
      title: 'Instructions',
      description: this.message
    });

    return extraFields;
  };
}

export const assertAssertions = (
  asserts: readonly Assertion[],
  values: Record<string, unknown>
) => {
  for (const assert of asserts) {
    const { fn, message, optional } = assert;

    try {
      const res = fn(values);
      if (res === undefined) {
        continue;
      }

      if (!res && message) {
        throw new AssertionError({ message, values, optional });
      }
    } catch (e) {
      const message = (e as Error).message;
      throw new AssertionError({ message, values, optional });
    }
  }
};

export const assertStreamingAssertions = (
  asserts: readonly StreamingAssertion[],
  values: Record<string, unknown>,
  xstate: Readonly<extractionState>,
  content: string
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
    const { message, optional, fn } = assert;

    try {
      const res = fn(currValue);
      if (res === undefined) {
        continue;
      }

      if (!res && message) {
        throw new AssertionError({ message, values, optional });
      }
    } catch (e) {
      const message = (e as Error).message;
      throw new AssertionError({ message, values, optional });
    }
  }
};

export const assertRequiredFields = (
  sig: Readonly<Signature>,
  values: Record<string, unknown>
) => {
  const fields = sig.getOutputFields();
  const missingFields = fields.filter((f) => !(f.name in values));
  if (missingFields.length > 0) {
    throw new AssertionError({
      message: `Missing required fields: ${missingFields.map((f) => f.name).join(', ')}`,
      values
    });
  }
};
