import { ReadableStream } from 'stream/web';

import type {
  TextResponse,
  TextResponseFunctionCall,
  TextResponseResult
} from '../ai/index.js';
import { mergeFunctionCalls, type mergeFunctionsState } from '../ai/util.js';
import {
  type AITextFunction,
  FunctionProcessor,
  Memory
} from '../text/index.js';
import type { AIMemory, AIService } from '../text/index.js';
import { type Span, SpanKind } from '../trace/index.js';
import { type AITextChatRequest } from '../types/index.js';

import {
  assertAssertions,
  type Assertion,
  AssertionError,
  assertRequiredFields,
  assertStreamingAssertions,
  type StreamingAssertion
} from './asserts.js';
import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
  ValidationError
} from './extract.js';
import {
  type GenIn,
  type GenOut,
  Program,
  type ProgramForwardOptions,
  validateValue,
  type Value
} from './program.js';
import { PromptTemplate } from './prompt.js';
import { Signature } from './sig.js';

export interface GenerateOptions {
  functions?: AITextFunction[];
  functionCall?: AITextChatRequest['functionCall'];
  promptTemplate?: typeof PromptTemplate;
  asserts?: Assertion[];
  streamingAsserts?: StreamingAssertion[];
}

export type GenerateResult<OUT extends GenOut> = OUT & {
  functions?: TextResponseFunctionCall[];
};

interface ResponseHandlerArgs<T> {
  res: T;
  usageInfo: { ai: string; model: string };
  mem: AIMemory;
  sessionId?: string;
  traceId?: string;
}

export class Generate<
  IN extends GenIn = GenIn,
  OUT extends GenerateResult<GenOut> = GenerateResult<GenOut>
> extends Program<IN, OUT> {
  private signature: Signature;
  private sigHash: string;
  private ai: AIService;
  private pt: PromptTemplate;
  private asserts: Assertion[];
  private streamingAsserts: StreamingAssertion[];
  private options?: GenerateOptions;
  private funcProc?: FunctionProcessor;
  private functionList?: string;

  constructor(
    ai: AIService,
    signature: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    super();

    this.signature = new Signature(signature);
    this.sigHash = this.signature.hash();
    this.ai = ai;
    this.options = options;
    this.pt = new (options?.promptTemplate ?? PromptTemplate)(this.signature);
    this.asserts = this.options?.asserts ?? [];
    this.streamingAsserts = this.options?.streamingAsserts ?? [];
    this.functionList = this.options?.functions?.map((f) => f.name).join(', ');
    this.usage = [];

    if (this.options?.functions) {
      this.funcProc = new FunctionProcessor(this.options?.functions);
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

  private _setExamples(examples: Readonly<Record<string, Value>[]>) {
    const sig = this.signature;
    const fields = [...sig.getInputFields(), ...sig.getOutputFields()];

    this.examples = examples.map((e) => {
      const res: Record<string, Value> = {};
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

  public override setExamples(examples: Readonly<Record<string, Value>[]>) {
    this._setExamples(examples);
    super.setExamples(examples);
  }

  public addAssert = (
    fn: Assertion['fn'],
    message?: string,
    optional?: boolean
  ) => {
    this.asserts.push({ fn, message, optional });
  };

  public addStreamingAssert = (
    fieldName: string,
    fn: StreamingAssertion['fn'],
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
    stream
  }: Readonly<
    Omit<ProgramForwardOptions, 'ai'> & { ai: AIService; stream: boolean }
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
      { chatPrompt, functions, functionCall, modelConfig },
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
    Omit<ProgramForwardOptions, 'ai' | 'mem'> & { ai: AIService; mem: AIMemory }
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
    ResponseHandlerArgs<ReadableStream<TextResponse>>
  >): Promise<OUT> {
    const functionCalls: NonNullable<TextResponseResult['functionCalls']> = [];
    const values = {};
    const xstate: extractionState = { s: -1 };
    const fstate: mergeFunctionsState = { lastId: '' };

    let content = '';

    for await (const v of res) {
      const result = v.results?.at(0);
      if (!result) {
        continue;
      }

      if (v.modelUsage) {
        this.usage.push({ ...usageInfo, ...v.modelUsage });
      }

      if (result.content) {
        content += result.content;
        mem.updateResult({ ...result, content, functionCalls }, sessionId);

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
        const fc = mergeFunctionCalls(
          functionCalls,
          result.functionCalls,
          fstate
        );

        let funcs;
        if (fc) {
          funcs = parseFunctions(this.ai, [fc], values);
        }

        if (funcs) {
          mem.updateResult({ ...result, content, functionCalls }, sessionId);
          await this.processFunctions(funcs, mem, sessionId, traceId);
        }
      }

      if (result.finishReason === 'length') {
        throw new Error('Max tokens reached before completion');
      }
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
  }: Readonly<ResponseHandlerArgs<TextResponse>>): Promise<OUT> {
    const values = {};

    const result = res.results?.at(0);
    if (!result) {
      throw new Error('No result found');
    }

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

    return { ...values } as unknown as OUT;
  }

  private async _forward(
    values: IN,
    options?: Readonly<ProgramForwardOptions>,
    span?: Span
  ): Promise<OUT> {
    const maxRetries = options?.maxRetries ?? 5;
    const mem = options?.mem ?? new Memory();
    const canStream = this.ai.getFeatures().streaming;

    let err: ValidationError | AssertionError | undefined;

    if (this.sigHash !== this.signature.hash()) {
      const promptTemplate = this.options?.promptTemplate ?? PromptTemplate;
      this.pt = new promptTemplate(this.signature);
    }

    const prompt = this.pt.toString<IN>(values, {
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

          //   if (mem.getLast(sessionId)?.role === 'assistant') {
          //     assertRequiredFields(this.signature, output);
          //     return output;
          //   }

          if (Object.keys(output).length > 0) {
            assertRequiredFields(this.signature, output);
            return output;
          }
        }
        throw new Error('Could not complete task within maximum allowed steps');
      } catch (e) {
        let extraFields;
        span?.recordException(e as Error);

        if (e instanceof ValidationError) {
          extraFields = e.getFixingInstructions();
          err = e;
        } else if (e instanceof AssertionError) {
          const e1 = e as AssertionError;
          extraFields = e1.getFixingInstructions(this.signature);
          err = e;
        } else {
          throw e;
        }

        if (extraFields) {
          const fields = this.pt.renderExtraFields(extraFields);
          const userMsg = {
            role: 'user' as const,
            content: fields.join('\n\n')
          };

          mem.add(userMsg, options?.sessionId);
          if (options?.debug) {
            console.log('Error Correction:', fields);
          }
        }
      }
    }

    if (err instanceof AssertionError && err.getOptional()) {
      return err.getValue() as OUT;
    }

    throw new Error(`Unable to fix validation error: ${err?.message}`);
  }

  public override async forward(
    values: IN,
    options?: Readonly<ProgramForwardOptions>
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
        kind: SpanKind.SERVER,
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
    functionCalls: readonly TextResponseFunctionCall[],
    mem: Readonly<Memory>,
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
              content: fres.result ?? '',
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
  ai: Readonly<AIService>,
  functionCalls: Readonly<TextResponseResult['functionCalls']>,
  values: Record<string, unknown>
): TextResponseFunctionCall[] | undefined {
  if (!functionCalls || functionCalls.length === 0) {
    return;
  }
  if (ai.getFeatures().functions) {
    const funcs: TextResponseFunctionCall[] = functionCalls.map((f) => ({
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
