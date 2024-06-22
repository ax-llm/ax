import { ReadableStream } from 'stream/web';

import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction
} from '../ai/types.js';
import { mergeFunctionCalls, type mergeFunctionsState } from '../ai/util.js';
import {
  type AxChatResponseFunctionCall,
  AxFunctionProcessor
} from '../funcs/functions.js';
import { type AxAIMemory, AxMemory } from '../mem/index.js';
import { type AxSpan, AxSpanKind } from '../trace/index.js';

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
  type AxFieldValue,
  type AxGenIn,
  type AxGenOut,
  AxProgram,
  type AxProgramForwardOptions
} from './program.js';
import { AxPromptTemplate } from './prompt.js';
import { AxSignature } from './sig.js';
import { validateValue } from './util.js';

export interface AxGenerateOptions {
  functions?: AxFunction[];
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
> extends AxProgram<IN, OUT> {
  private signature: AxSignature;
  private sigHash: string;
  private ai: AxAIService;
  private pt: AxPromptTemplate;
  private asserts: AxAssertion[];
  private streamingAsserts: AxStreamingAssertion[];
  private options?: AxGenerateOptions;
  private funcProc?: AxFunctionProcessor;
  private functionList?: string;

  constructor(
    ai: AxAIService,
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenerateOptions>
  ) {
    super();

    this.signature = new AxSignature(signature);
    this.sigHash = this.signature.hash();
    this.ai = ai;
    this.options = options;
    this.pt = new (options?.promptTemplate ?? AxPromptTemplate)(this.signature);
    this.asserts = this.options?.asserts ?? [];
    this.streamingAsserts = this.options?.streamingAsserts ?? [];
    this.functionList = this.options?.functions?.map((f) => f.name).join(', ');
    this.usage = [];

    if (this.options?.functions) {
      this.funcProc = new AxFunctionProcessor(this.options?.functions);
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

  private _setExamples(examples: Readonly<Record<string, AxFieldValue>[]>) {
    const sig = this.signature;
    const fields = [...sig.getInputFields(), ...sig.getOutputFields()];

    this.examples = examples.map((e) => {
      const res: Record<string, AxFieldValue> = {};
      for (const f of fields) {
        const value = e[f.name];
        if (value) {
          validateValue(f, value);
          res[f.name] = value;
        }
      }
      return res;
    });
  }

  public override setExamples(
    examples: Readonly<Record<string, AxFieldValue>[]>
  ) {
    this._setExamples(examples);
    super.setExamples(examples);
  }

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
    model
  }: Readonly<
    Omit<AxProgramForwardOptions, 'ai'> & { ai: AxAIService; stream: boolean }
  >) {
    const chatPrompt = mem?.history(sessionId) ?? [];

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found');
    }

    const functions = this.options?.functions;
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
    stream = false
  }: Readonly<
    Omit<AxProgramForwardOptions, 'ai' | 'mem'> & {
      ai: AxAIService;
      mem: AxAIMemory;
    }
  >): Promise<OUT> {
    const usageInfo = {
      ai: this.ai.getName(),
      model: this.ai.getModelInfo().name
    };

    const res = await this.forwardSendRequest({
      mem,
      sessionId,
      traceId,
      ai,
      stream,
      modelConfig
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

    // streamingExtractFinalValue(values, xstate, content);
    // assertAssertions(this.asserts, values);

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
    const maxRetries = options?.maxRetries ?? 5;
    const mem = options?.mem ?? new AxMemory();
    const canStream = this.ai.getFeatures().streaming;

    let err: ValidationError | AxAssertionError | undefined;

    if (this.sigHash !== this.signature.hash()) {
      const promptTemplate = this.options?.promptTemplate ?? AxPromptTemplate;
      this.pt = new promptTemplate(this.signature);
    }

    const prompt = this.pt.render<IN>(values, {
      examples: this.examples,
      demos: this.demos
    });

    const userMsg = { role: 'user' as const, content: prompt };
    mem.add(userMsg, options?.sessionId);

    for (let i = 0; i < maxRetries; i++) {
      try {
        for (let n = 0; n < (options?.maxSteps ?? 10); n++) {
          const {
            sessionId,
            traceId,
            modelConfig,
            stream: doStream
          } = options ?? {};
          const stream = canStream && doStream;

          const output = await this.forwardCore({
            ai: options?.ai ?? this.ai,
            mem,
            sessionId,
            traceId,
            modelConfig,
            stream,
            maxSteps: options?.maxSteps
          });

          const lastMemItem = mem.getLast(sessionId);

          if (lastMemItem?.role !== 'function') {
            assertRequiredFields(this.signature, output);
            return output;
          }
        }
        throw new Error('Could not complete task within maximum allowed steps');
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
          const userMsg = {
            role: 'user' as const,
            content
          };

          mem.add(userMsg, options?.sessionId);
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

  public override async forward(
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    if (!options?.tracer) {
      return await this._forward(values, options);
    }

    const attributes = {
      ['generate.signature']: this.signature.toString(),
      ['generate.functions']: this.functionList ?? 'none'
    };

    return await options?.tracer.startActiveSpan(
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
    for (const func of functionCalls) {
      const fres = await this.funcProc?.execute(func, {
        sessionId,
        traceId
      });

      if (fres?.id) {
        mem.add(
          [
            {
              role: 'function' as const,
              result: fres.result ?? '',
              functionId: fres.id
            }
          ],
          sessionId
        );
      }
    }
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
      args: f.function.arguments as string
    }));

    // for (const [i, f] of funcs.entries()) {
    //   values['functionName' + i] = f.name;
    //   values['functionArguments' + i] =
    //     typeof f.args === 'object' ? JSON.stringify(f.args) : f.args;
    // }
    return funcs;
  } else if (values.functionName) {
    const { functionName, functionArguments } = values as {
      functionName: string;
      functionArguments: string;
      other: object;
    };
    delete values.functionName;
    delete values.functionArguments;

    return [
      {
        name: functionName,
        args: functionArguments
      }
    ];
  }
}
