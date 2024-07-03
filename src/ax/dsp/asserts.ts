import type { extractionState } from './extract.js';
import type { AxSignature } from './sig.js';

export interface AxAssertion {
  fn(values: Record<string, unknown>): boolean | undefined;
  message?: string;
  optional?: boolean;
}

export interface AxStreamingAssertion {
  fieldName: string;
  fn(content: string): boolean | undefined;
  message?: string;
  optional?: boolean;
}

export class AxAssertionError extends Error {
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
  public getFixingInstructions = (_sig: Readonly<AxSignature>) => {
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

// eslint-disable-next-line @typescript-eslint/naming-convention
export const assertAssertions = (
  asserts: readonly AxAssertion[],
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
        throw new AxAssertionError({ message, values, optional });
      }
    } catch (e) {
      const message = (e as Error).message;
      throw new AxAssertionError({ message, values, optional });
    }
  }
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const assertStreamingAssertions = (
  asserts: readonly AxStreamingAssertion[],
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
        throw new AxAssertionError({ message, values, optional });
      }
    } catch (e) {
      const message = (e as Error).message;
      throw new AxAssertionError({ message, values, optional });
    }
  }
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const assertRequiredFields = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>
) => {
  const fields = sig.getOutputFields();
  const missingFields = fields.filter((f) => !(f.name in values));
  if (missingFields.length > 0) {
    throw new AxAssertionError({
      message: `Missing required fields: ${missingFields.map((f) => f.name).join(', ')}`,
      values
    });
  }
};
