import { TextResponse } from '../ai';
import { AIService } from '../text/types';

import { PromptTemplate, PromptValues } from './prompt';
import { extractValues, IField, Signature, ValidationError } from './sig';

export interface GenerateOptions {
  promptTemplate?: typeof PromptTemplate;
  asserts?: Assertion[];
  maxRetries?: number;
}

export interface Assertion {
  fn(arg0: Record<string, unknown>): boolean;
  errMsg: string;
  optional?: boolean;
}

export class Generate {
  private sig: Signature;
  private ai: AIService;
  private pt: PromptTemplate;
  private asserts: Assertion[];
  private options?: GenerateOptions;

  constructor(
    ai: Readonly<AIService>,
    sig: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    this.ai = ai;
    this.options = options;
    this.sig = typeof sig === 'string' ? new Signature(sig) : sig.clone();
    this.pt = new (options?.promptTemplate ?? PromptTemplate)(this.sig);
    this.asserts = this.options?.asserts ?? [];
  }

  public getSignture = () => this.sig.clone();

  // eslint-disable-next-line functional/prefer-immutable-types
  public setSignature = (setFn: (sig: Signature) => void) => {
    setFn(this.sig);
    this.pt = new (this.options?.promptTemplate ?? PromptTemplate)(this.sig);
  };

  public addAssert = (
    fn: Assertion['fn'],
    errMsg: string,
    optional?: boolean
  ) => {
    this.asserts.push({ fn, errMsg, optional });
  };

  public _forward = async (values: PromptValues, xf?: readonly IField[]) => {
    const prompt = this.pt.toString(values, xf);
    const aiRes = await this.ai.chat({
      chatPrompt: [{ role: 'user', text: prompt }]
    });

    const res = aiRes as unknown as TextResponse;
    const result = res.results?.at(0);

    if (!result) {
      throw new Error('No results from AI');
    }

    const retval = extractValues(this.sig, result.text);

    this.asserts.forEach((a) => {
      if (!a.fn(retval)) {
        throw new AssertionError({
          message: a.errMsg,
          value: retval,
          optional: a.optional
        });
      }
    });

    return retval;
  };

  public forward = async (values: PromptValues) => {
    let xf: IField[] = [];
    let err: ValidationError | AssertionError | undefined;

    for (let i = 0; i < (this.options?.maxRetries ?? 3); i++) {
      try {
        return await this._forward(values, xf);
      } catch (e) {
        if (e instanceof ValidationError) {
          const f = e.getField();

          xf = [
            {
              name: 'past_' + f.name,
              title: 'Past ' + f.title,
              description: e.getValue()
            },
            {
              name: 'instructions',
              title: 'Instructions',
              description: e.message
            }
          ];

          err = e;
        } else if (e instanceof AssertionError) {
          const e1 = e as AssertionError;
          xf = [];
          this.sig.getOutputFields().forEach((f) => {
            const values = e1.getValue();
            xf.push({
              name: 'past_' + f.name,
              title: 'Past ' + f.title,
              description: JSON.stringify(values[f.name])
            });
          });

          xf.push({
            name: 'instructions',
            title: 'Instructions',
            description: e1.message
          });
          err = e;
        } else {
          throw e;
        }
      }
    }

    if (err instanceof AssertionError && err.getOptional()) {
      return err.getValue();
    }

    throw new Error('Unable to fix validation error: ' + err?.message);
  };
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
    Error.captureStackTrace(this, this.constructor);
  }
  public getValue = () => this.value;
  public getOptional = () => this.optional;
}
