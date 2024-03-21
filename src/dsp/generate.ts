import type { TextResponse, TextResponseFunctionCall } from '../ai/index.js';
import type { AITextChatRequest } from '../index.js';
import type { AITextFunction } from '../text/index.js';
import type { AIMemory, AIService } from '../text/index.js';

import { type GenIn, type GenOut, PromptTemplate } from './prompt.js';
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
  maxRetries?: number;
}

export type GenerateForwardOptions = {
  maxRetries?: number;
  maxSteps?: number;
  mem: AIMemory;
  sessionId?: string;
  traceId?: string | undefined;
  skipSystemPrompt?: boolean;
};

export interface Assertion {
  fn(arg0: Record<string, unknown>): boolean;
  errMsg: string;
  optional?: boolean;
}

export type ForwardResult<T> = T & {
  functions?: TextResponseFunctionCall[];
};

export interface IGenerate<
  IN extends GenIn = GenIn,
  OUT extends GenIn = GenOut
> {
  //   getSignture(): Signature;
  //   updateSignature(setFn: (sig: Readonly<Signature>) => void): void;
  //   addAssert(fn: Assertion['fn'], errMsg: string, optional?: boolean): void;
  forward(values: IN): Promise<OUT>;
}

export class Generate<IN extends GenIn = GenIn, OUT extends GenIn = GenOut>
  implements IGenerate<IN, OUT>
{
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
    skipSystemPrompt
  }: Readonly<{
    values: IN;
    extraFields?: readonly IField[];
    mem?: AIMemory;
    sessionId?: string;
    traceId?: string;
    skipSystemPrompt?: boolean;
  }>): Promise<ForwardResult<OUT>> => {
    const prompt = this.pt.toString<IN>(values, {
      extraFields,
      skipSystemPrompt
    });
    const msg = { role: 'user' as const, content: prompt };
    const chatPrompt = [...(mem?.history(sessionId) ?? []), msg];

    const functions = this.options?.functions;
    const functionCall = this.options?.functionCall;

    const aiRes = await this.ai.chat(
      { chatPrompt, functions, functionCall },
      {
        stopSequences: [],
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

    return retval as ForwardResult<OUT>;
  };

  public forward = async (
    values: IN,
    options?: Readonly<GenerateForwardOptions>
  ): Promise<ForwardResult<OUT>> => {
    const maxRetries = options?.maxRetries ?? this.options?.maxRetries ?? 3;

    let extraFields: IField[] = [];
    let err: ValidationError | AssertionError | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this._forward({
          values,
          extraFields,
          mem: options?.mem,
          sessionId: options?.sessionId,
          traceId: options?.traceId,
          skipSystemPrompt: options?.skipSystemPrompt
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
      return err.getValue() as ForwardResult<OUT>;
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
