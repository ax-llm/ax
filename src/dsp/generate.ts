import type { TextResponse, TextResponseFunctionCall } from '../ai/index.js';
import type { AITextChatRequest } from '../index.js';
import type { AITextFunction } from '../text/index.js';
import type { AIService } from '../text/index.js';

import { GenIn, GenOut, Program, ProgramForwardOptions } from './program.js';
import { PromptTemplate } from './prompt.js';
import {
  extractValues,
  type IField,
  Signature,
  ValidationError
} from './sig.js';

export type FunctionSpec = {
  readonly name: string;
  readonly description: string;
  readonly parameters?: object;
};

export interface GenerateOptions {
  functions?: AITextFunction[];
  functionCall?: AITextChatRequest['functionCall'];
  promptTemplate?: typeof PromptTemplate;
  asserts?: Assertion[];
}

export interface Assertion {
  fn(arg0: Record<string, unknown>): boolean;
  errMsg: string;
  optional?: boolean;
}

export type GenerateResult<OUT extends GenOut> = Omit<OUT, 'functions'> & {
  functions?: TextResponseFunctionCall[];
};

export class Generate<
  IN extends GenIn = GenIn,
  OUT extends GenerateResult<OUT> = GenOut
> extends Program<IN, OUT> {
  private sig: Signature;
  private ai: AIService;
  private pt: PromptTemplate;
  private asserts: Assertion[];
  private options?: GenerateOptions;

  constructor(
    ai: AIService,
    signature: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    super();

    this.ai = ai;
    this.options = options;
    this.sig = new Signature(signature);
    this.pt = new (options?.promptTemplate ?? PromptTemplate)(this.sig);
    this.asserts = this.options?.asserts ?? [];

    if (this.options?.functions) {
      if (!this.ai.getFeatures().functions) {
        this.updateSigForFunctions(this.sig);
      }
    }
  }

  public getSignature = (): Signature => this.sig;

  // eslint-disable-next-line functional/prefer-immutable-types
  public updateSignature = (setFn: (sig: Signature) => void) => {
    setFn(this.sig);
    this.pt = new (this.options?.promptTemplate ?? PromptTemplate)(this.sig);
  };

  private updateSigForFunctions = (sig: Readonly<Signature>) => {
    // These are the fields for the function call only needed when the underlying LLM API does not support function calling natively in the API.
    sig.addOutputField({
      name: 'functionName',
      description: 'Name of function to call',
      isOptional: true
    });

    sig.addOutputField({
      name: 'functionArguments',
      description: 'Arguments of function to call',
      isOptional: true
    });
  };

  public addAssert = (
    fn: Assertion['fn'],
    errMsg: string,
    optional?: boolean
  ) => {
    this.asserts.push({ fn, errMsg, optional });
  };

  private _forward = async ({
    values,
    extraFields,
    mem,
    sessionId,
    traceId,
    skipSystemPrompt,
    ai,
    modelConfig
  }: Readonly<
    ProgramForwardOptions & {
      values: IN;
      extraFields?: readonly IField[];
    }
  >): Promise<OUT> => {
    const prompt = this.pt.toString<IN>(values, {
      extraFields,
      skipSystemPrompt,
      examples: this.examples,
      demos: this.demos
    });

    const msg = { role: 'user' as const, content: prompt };
    const chatPrompt = [...(mem?.history(sessionId) ?? []), msg];

    const functions = this.options?.functions;
    const functionCall = this.options?.functionCall;
    const _ai = ai ?? this.ai;

    const aiRes = await _ai.chat(
      { chatPrompt, functions, functionCall, modelConfig },
      {
        ...(sessionId ? { sessionId } : {}),
        ...(traceId ? { traceId } : {})
      }
    );
    const res = aiRes as unknown as TextResponse;
    const result = res.results?.at(0);

    if (!result) {
      throw new Error('No result found');
    }

    let retval: Record<string, unknown> = {};

    if (result.content) {
      retval = extractValues(this.sig, result.content);

      for (const a of this.asserts) {
        if (!a.fn(retval)) {
          throw new AssertionError({
            message: a.errMsg,
            value: retval,
            optional: a.optional
          });
        }
      }
    }

    if (this.ai.getFeatures().functions) {
      retval.functions = result.functionCalls?.map((f) => ({
        id: f.id,
        name: f.function.name,
        args: f.function.arguments
      }));
    } else if (retval.functionName) {
      const { functionName, functionArguments, ...other } = retval;

      retval = {
        ...other,
        functions: [
          {
            name: functionName,
            args: functionArguments
          }
        ]
      };
    }

    mem?.add(msg, sessionId);
    mem?.addResult(result, sessionId);

    this.setTrace({ ...values, ...retval });

    return retval as OUT;
  };

  override forward = async (
    values: IN,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<OUT> => {
    const maxRetries = options?.maxRetries ?? 3;

    let extraFields: IField[] = [];
    let err: ValidationError | AssertionError | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this._forward({
          ...options,
          values,
          extraFields
        });
      } catch (e) {
        if (e instanceof ValidationError) {
          const f = e.getField();

          extraFields = [
            {
              name: `past_${f.name}`,
              title: `Past ${f.title}`,
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
          extraFields = [];

          for (const f of this.sig.getOutputFields()) {
            const values = e1.getValue();
            extraFields.push({
              name: `past_${f.name}`,
              title: `Past ${f.title}`,
              description: JSON.stringify(values[f.name])
            });
          }

          extraFields.push({
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
      return err.getValue() as OUT;
    }

    throw new Error(`Unable to fix validation error: ${err?.message}`);
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
