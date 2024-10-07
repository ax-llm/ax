import { ReadableStream } from 'stream/web';

import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxRateLimiterFunction
} from '../ai/types.js';
import { mergeFunctionCalls } from '../ai/util.js';
import { type AxAIMemory, AxMemory } from '../mem/index.js';
import { type AxSpan, AxSpanKind, type AxTracer } from '../trace/index.js';

import {
  assertAssertions,
  assertRequiredFields,
  assertStreamingAssertions,
  type AxAssertion,
  AxAssertionError,
  type AxStreamingAssertion
} from './asserts.js';
import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
  ValidationError
} from './extract.js';
import {
  type AxChatResponseFunctionCall,
  AxFunctionProcessor
} from './functions.js';
import {
  type AxGenIn,
  type AxGenOut,
  type AxProgramForwardOptions,
  AxProgramWithSignature
} from './program.js';
import { AxPromptTemplate } from './prompt.js';
import { AxSignature } from './sig.js';

export interface AxGenerateOptions {
  maxCompletions?: number;
  maxRetries?: number;
  maxSteps?: number;
  mem?: AxAIMemory;
  tracer?: AxTracer;
  rateLimiter?: AxRateLimiterFunction;
  stream?: boolean;
  debug?: boolean;

  functions?: AxFunction[] | { toFunction: () => AxFunction }[];
  functionCall?: AxChatRequest['functionCall'];
  promptTemplate?: typeof AxPromptTemplate;
  asserts?: AxAssertion[];
  streamingAsserts?: AxStreamingAssertion[];
}

export type AxGenerateResult<OUT extends AxGenOut> = OUT & {
  functions?: AxChatResponseFunctionCall[];
};

export interface AxResponseHandlerArgs<T> {
  res: T;
  usageInfo: { ai: string; model: string };
  mem: AxAIMemory;
  sessionId?: string;
  traceId?: string;
}

export class AxGenerate<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenerateResult<AxGenOut> = AxGenerateResult<AxGenOut>
> extends AxProgramWithSignature<IN, OUT> {
  private ai: AxAIService;
  private pt: AxPromptTemplate;
  private asserts: AxAssertion[];
  private streamingAsserts: AxStreamingAssertion[];
  private options?: Omit<AxGenerateOptions, 'functions'>;

  private functions?: AxFunction[];
  private funcProc?: AxFunctionProcessor;
  private functionList?: string;

  constructor(
    ai: AxAIService,
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenerateOptions>
  ) {
    super(signature);

    this.functions = options?.functions?.map((f) => {
      if ('toFunction' in f) {
        return f.toFunction();
      }
      return f;
    });

    this.ai = ai;
    this.options = options;
    this.pt = new (options?.promptTemplate ?? AxPromptTemplate)(this.signature);
    this.asserts = this.options?.asserts ?? [];
    this.streamingAsserts = this.options?.streamingAsserts ?? [];
    this.functionList = this.functions?.map((f) => f.name).join(', ');
    this.usage = [];

    if (this.functions) {
      this.funcProc = new AxFunctionProcessor(this.functions);
      this.updateSigForFunctions();
    }
  }

  private updateSigForFunctions = () => {
    // AI supports function calling natively so
    // no need to add fields for function call
    if (this.ai.getFeatures().functions) {
      return;
    }

    // These are the fields for the function call only needed when the underlying LLM API does not support function calling natively in the API.
    this.signature.addOutputField({
      name: 'functionName',
      description: 'Name of function to call',
      isOptional: true
    });

    this.signature.addOutputField({
      name: 'functionArguments',
      description: 'Arguments of function to call',
      isOptional: true
    });
  };

  public addAssert = (
    fn: AxAssertion['fn'],
    message?: string,
    optional?: boolean
  ) => {
    this.asserts.push({ fn, message, optional });
  };

  public addStreamingAssert = (
    fieldName: string,
    fn: AxStreamingAssertion['fn'],
    message?: string,
    optional?: boolean
  ) => {
    this.streamingAsserts.push({ fieldName, fn, message, optional });
  };

  private async forwardSendRequest({
    mem,
    sessionId,
    traceId,
    ai,
    modelConfig: mc,
    stream,
    model,
    rateLimiter
  }: Readonly<
    Omit<AxProgramForwardOptions, 'ai'> & { ai: AxAIService; stream: boolean }
  >) {
    const chatPrompt = mem?.history(sessionId) ?? [];

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found');
    }

    const functions = this.functions;
    const functionCall = this.options?.functionCall;

    const hasJSON = this.signature
      .getOutputFields()
      .some((f) => f?.type?.name === 'json' || f?.type?.isArray);

    const modelConfig = mc
      ? {
          ...mc,
          ...(hasJSON ? { outputFormat: 'json_object' } : {})
        }
      : undefined;

    const res = await ai.chat(
      {
        chatPrompt,
        functions,
        functionCall,
        modelConfig,
        ...(model ? { model } : {})
      },
      {
        ...(sessionId ? { sessionId } : {}),
        ...(traceId ? { traceId } : {}),
        ...(rateLimiter ? { rateLimiter } : {}),
        stream
      }
    );

    return res;
  }

  private async forwardCore({
    mem,
    sessionId,
    traceId,
    ai,
    modelConfig,
    rateLimiter,
    stream = false
  }: Readonly<
    Omit<AxProgramForwardOptions, 'ai' | 'mem'> & {
      ai: AxAIService;
      mem: AxAIMemory;
    }
  >): Promise<OUT> {
    const usageInfo = {
      ai: ai.getName(),
      model: ai.getModelInfo().name
    };

    const res = await this.forwardSendRequest({
      mem,
      sessionId,
      traceId,
      ai,
      stream,
      modelConfig,
      rateLimiter
    });

    if (res instanceof ReadableStream) {
      return (await this.processSteamingResponse({
        res,
        usageInfo,
        mem,
        traceId,
        sessionId
      })) as unknown as OUT;
    }

    return (await this.processResponse({
      res,
      usageInfo,
      mem,
      traceId,
      sessionId
    })) as unknown as OUT;
  }

  private async processSteamingResponse({
    res,
    usageInfo,
    mem,
    sessionId,
    traceId
  }: Readonly<
    AxResponseHandlerArgs<ReadableStream<AxChatResponse>>
  >): Promise<OUT> {
    const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> =
      [];
    const values = {};
    const xstate: extractionState = { s: -1 };

    let content = '';

    for await (const v of res) {
      for (const result of v.results ?? []) {
        if (v.modelUsage) {
          this.usage.push({ ...usageInfo, ...v.modelUsage });
        }

        if (result.content) {
          content += result.content;

          mem.updateResult({ name: result.name, content }, sessionId);

          assertStreamingAssertions(
            this.streamingAsserts,
            values,
            xstate,
            content
          );
          streamingExtractValues(this.signature, values, xstate, content);
          assertAssertions(this.asserts, values);
        }

        if (result.functionCalls) {
          mergeFunctionCalls(functionCalls, result.functionCalls);

          mem.updateResult(
            { name: result.name, content, functionCalls },
            sessionId
          );
        }

        if (result.finishReason === 'length') {
          throw new Error('Max tokens reached before completion');
        }
      }
    }

    const funcs = parseFunctions(this.ai, functionCalls, values);
    if (funcs) {
      await this.processFunctions(funcs, mem, sessionId, traceId);
    }

    streamingExtractFinalValue(values, xstate, content);
    assertAssertions(this.asserts, values);

    return { ...values } as unknown as OUT;
  }

  private async processResponse({
    res,
    usageInfo,
    mem,
    sessionId,
    traceId
  }: Readonly<AxResponseHandlerArgs<AxChatResponse>>): Promise<OUT> {
    const values = {};

    for (const result of res.results ?? []) {
      if (res.modelUsage) {
        this.usage.push({ ...usageInfo, ...res.modelUsage });
      }

      mem.addResult(result, sessionId);

      if (result.content) {
        extractValues(this.signature, values, result.content);
        assertAssertions(this.asserts, values);
      }

      if (result.functionCalls) {
        const funcs = parseFunctions(this.ai, result.functionCalls, values);

        if (funcs) {
          await this.processFunctions(funcs, mem, sessionId, traceId);
        }
      }

      if (result.finishReason === 'length') {
        throw new Error('Max tokens reached before completion');
      }
    }

    return { ...values } as unknown as OUT;
  }

  private async _forward(
    values: IN,
    options?: Readonly<AxProgramForwardOptions>,
    span?: AxSpan
  ): Promise<OUT> {
    const ai = options?.ai ?? this.ai;
    const maxRetries = options?.maxRetries ?? this.options?.maxRetries ?? 5;
    const maxSteps = options?.maxSteps ?? this.options?.maxSteps ?? 10;
    const mem = options?.mem ?? this.options?.mem ?? new AxMemory();
    const canStream = ai.getFeatures().streaming;

    let err: ValidationError | AxAssertionError | undefined;

    if (this.sigHash !== this.signature.hash()) {
      const promptTemplate = this.options?.promptTemplate ?? AxPromptTemplate;
      this.pt = new promptTemplate(this.signature);
    }

    const prompt = this.pt.render<IN>(values, {
      examples: this.examples,
      demos: this.demos
    });

    mem.add(prompt, options?.sessionId);

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const {
            sessionId,
            traceId,
            modelConfig,
            stream: doStream = true
          } = options ?? {};
          const stream = canStream && doStream;

          const output = await this.forwardCore({
            ai,
            mem,
            sessionId,
            traceId,
            modelConfig,
            stream,
            maxSteps: options?.maxSteps,
            rateLimiter: options?.rateLimiter
          });

          const lastMemItem = mem.getLast(sessionId);

          if (lastMemItem?.role === 'function') {
            continue multiStepLoop;
          }

          assertRequiredFields(this.signature, output);
          this.trace = { ...output };
          return output;
        } catch (e) {
          let extraFields;
          span?.recordAxSpanException(e as Error);

          if (e instanceof ValidationError) {
            extraFields = e.getFixingInstructions();
            err = e;
          } else if (e instanceof AxAssertionError) {
            const e1 = e as AxAssertionError;
            extraFields = e1.getFixingInstructions(this.signature);
            err = e;
          } else {
            throw e;
          }

          if (extraFields) {
            const content = this.pt.renderExtraFields(extraFields);
            mem.add({ role: 'user' as const, content }, options?.sessionId);

            if (options?.debug) {
              console.log('Error Correction:', content);
            }
          }
        }
      }
      if (err instanceof AxAssertionError && err.getOptional()) {
        return err.getValue() as OUT;
      }

      throw new Error(`Unable to fix validation error: ${err?.message}`);
    }

    throw new Error('Could not complete task within maximum allowed steps');
  }

  public override async forward(
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    const tracer = this.options?.tracer ?? options?.tracer;

    if (!tracer) {
      return await this._forward(values, options);
    }

    const attributes = {
      ['generate.signature']: this.signature.toString(),
      ['generate.functions']: this.functionList ?? 'none'
    };

    return await tracer.startActiveSpan(
      'Generate',
      {
        kind: AxSpanKind.SERVER,
        attributes
      },
      async (span) => {
        const res = this._forward(values, options, span);
        span.end();
        return res;
      }
    );
  }

  public processFunctions = async (
    functionCalls: readonly AxChatResponseFunctionCall[],
    mem: Readonly<AxMemory>,
    sessionId?: string,
    traceId?: string
  ) => {
    // Map each function call to a promise that resolves to the function result or null
    const promises = functionCalls.map((func) =>
      this.funcProc?.execute(func, { sessionId, traceId }).then((fres) => {
        if (fres?.id) {
          return {
            role: 'function' as const,
            result: fres.result ?? '',
            functionId: fres.id
          };
        }
        return null; // Returning null for function calls that don't meet the condition
      })
    );

    // Wait for all promises to resolve
    const results = await Promise.all(promises);

    results.forEach((result) => {
      if (result) {
        mem.add(result, sessionId);
      }
    });
  };
}

function parseFunctions(
  ai: Readonly<AxAIService>,
  functionCalls: Readonly<AxChatResponseResult['functionCalls']>,
  values: Record<string, unknown>
): AxChatResponseFunctionCall[] | undefined {
  if (!functionCalls || functionCalls.length === 0) {
    return;
  }
  if (ai.getFeatures().functions) {
    const funcs: AxChatResponseFunctionCall[] = functionCalls.map((f) => ({
      id: f.id,
      name: f.function.name,
      args: f.function.params as string
    }));

    // for (const [i, f] of funcs.entries()) {
    //   values['functionName' + i] = f.name;
    //   values['functionArguments' + i] =
    //     typeof f.args === 'object' ? JSON.stringify(f.args) : f.args;
    // }
    return funcs;
  } else if (values['functionName']) {
    const { functionName, functionArguments } = values as {
      functionName: string;
      functionArguments: string;
      other: object;
    };
    delete values['functionName'];
    delete values['functionArguments'];

    return [
      {
        name: functionName,
        args: functionArguments
      }
    ];
  }
}
