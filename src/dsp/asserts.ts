import type { Signature } from './sig.js';

export interface Assertion {
  fn(arg0: Record<string, unknown>): boolean | undefined;
  errMsg?: string;
  optional?: boolean;
}

export class AssertionError extends Error {
  private value: Record<string, unknown>;
  private optional?: boolean;

  constructor({
    message,
    value
  }: Readonly<{
    message: string;
    value: Record<string, unknown>;
    optional?: boolean;
  }>) {
    super(message);
    this.value = value;
    this.name = this.constructor.name;
    this.stack = new Error().stack;
  }
  public getValue = () => this.value;
  public getOptional = () => this.optional;

  public getFixingInstructions = (sig: Readonly<Signature>) => {
    const extraFields = [];

    for (const f of sig.getOutputFields()) {
      extraFields.push({
        name: `past_${f.name}`,
        title: `Past ${f.title}`,
        description: JSON.stringify(this.value[f.name])
      });
    }

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
  for (const a of asserts) {
    try {
      const res = a.fn(values);
      if (res === undefined) {
        continue;
      }
      if (!res && a.errMsg) {
        throw new AssertionError({
          message: a.errMsg,
          value: values,
          optional: a.optional
        });
      }
    } catch (e) {
      throw new AssertionError({
        message: (e as Error).message,
        value: values,
        optional: a.optional
      });
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
      value: values
    });
  }
};
