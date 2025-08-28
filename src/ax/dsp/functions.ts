import { logFunctionError, logFunctionResults } from '../ai/debug.js';
// Note: We intentionally avoid importing OpenTelemetry types directly here to
// keep this module portable across environments that may not resolve OTel types.
import type {
  AxAIService,
  AxChatRequest,
  AxChatResponseResult,
  AxFunction,
  AxFunctionResult,
  AxLoggerFunction,
} from '../ai/types.js';
import type { AxMemory } from '../mem/memory.js';
import { axGlobals } from './globals.js';
import { validateJSONSchema } from './jsonschema.js';
import type { AxProgramForwardOptions } from './types.js';

export class AxStopFunctionCallException extends Error {
  public readonly calls: ReadonlyArray<{
    func: Readonly<AxFunction>;
    args: unknown;
    result: unknown;
  }>;

  constructor(
    calls: ReadonlyArray<{
      func: Readonly<AxFunction>;
      args: unknown;
      result: unknown;
    }>
  ) {
    super(
      `Stop function executed: ${calls.map((c) => c.func.name).join(', ')}`
    );
    this.name = 'AxStopFunctionCallException';
    this.calls = calls;
  }
}

export class AxFunctionError extends Error {
  constructor(
    private fields: {
      field: string;
      message: string;
    }[]
  ) {
    super();
    this.name = this.constructor.name;
  }

  getFields = () => this.fields;

  override toString(): string {
    return [
      `${this.name}: Function validation error`,
      ...this.fields.map((field) => `  - ${field.field}: ${field.message}`),
    ].join('\n');
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

type FunctionFieldErrors = ConstructorParameters<typeof AxFunctionError>[0];

export class FunctionError extends Error {
  constructor(
    private readonly fields: FunctionFieldErrors,
    private readonly func: Readonly<AxFunction>,
    private readonly funcId?: string
  ) {
    super();
  }

  getFunctionId = () => this.funcId;

  private getFieldDescription(fieldName: string): string {
    if (!this.func.parameters?.properties?.[fieldName]) {
      return '';
    }

    const fieldSchema = this.func.parameters.properties[fieldName];
    let description = fieldSchema.description;

    if (fieldSchema.enum?.length) {
      description += ` Allowed values are: ${fieldSchema.enum.join(', ')}`;
    }

    return description;
  }

  public getFixingInstructions = () => {
    const bulletPoints = this.fields.map((fieldError) => {
      const schemaDescription =
        this.getFieldDescription(fieldError.field) || '';
      return `- \`${fieldError.field}\` - ${fieldError.message} (${schemaDescription}).`;
    });

    return `Errors In Function Arguments: Fix the following invalid arguments to '${this.func.name}'\n${bulletPoints.join('\n')}`;
  };

  override toString(): string {
    return [
      `${this.name}: Function execution error in '${this.func.name}'`,
      ...this.fields.map((field) => {
        const description = this.getFieldDescription(field.field);
        return `  - ${field.field}: ${field.message}${description ? ` (${description})` : ''}`;
      }),
      this.funcId ? `  Function ID: ${this.funcId}` : '',
    ].join('\n');
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

export type AxChatResponseFunctionCall = {
  id: string;
  name: string;
  args: string;
};

export class AxFunctionProcessor {
  private funcList: Readonly<AxFunction[]> = [];

  constructor(funcList: Readonly<AxFunction[]>) {
    this.funcList = funcList;
  }

  private executeFunction = async <MODEL>(
    fnSpec: Readonly<AxFunction>,
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<
      AxProgramForwardOptions<MODEL> & {
        traceId?: string;
        stopFunctionNames?: readonly string[];
      }
    >
  ) => {
    let args: unknown;

    if (typeof func.args === 'string' && func.args.length > 0) {
      args = JSON.parse(func.args);
    } else {
      args = func.args;
    }

    const opt = options
      ? {
          sessionId: options.sessionId,
          traceId: options.traceId,
          ai: options.ai,
        }
      : undefined;

    let res: unknown;
    if (!fnSpec.parameters) {
      res =
        fnSpec.func.length === 1 ? await fnSpec.func(opt) : await fnSpec.func();
    } else {
      res =
        fnSpec.func.length === 2
          ? await fnSpec.func(args, opt)
          : await fnSpec.func(args);
    }

    const formatter =
      options?.functionResultFormatter ?? axGlobals.functionResultFormatter;
    const formatted = formatter(res);
    return {
      formatted: String(formatted),
      rawResult: res,
      parsedArgs: args,
    } as const;
  };

  public executeWithDetails = async <MODEL>(
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<
      AxProgramForwardOptions<MODEL> & {
        traceId?: string;
        stopFunctionNames?: readonly string[];
      }
    >
  ): Promise<{
    formatted: string;
    rawResult: unknown;
    parsedArgs: unknown;
  }> => {
    const normalize = (s: string) =>
      s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const target = normalize(func.name);

    let fnSpec = this.funcList.find((v) => v.name === func.name);
    if (!fnSpec) {
      fnSpec = this.funcList.find((v) => normalize(v.name) === target);
    }
    if (!fnSpec) {
      throw new Error(`Function not found: ${func.name}`);
    }
    if (!fnSpec.func) {
      throw new Error(`No handler for function: ${func.name}`);
    }

    try {
      return await this.executeFunction<MODEL>(fnSpec, func, options);
    } catch (e) {
      if (e instanceof AxFunctionError) {
        throw new FunctionError(e.getFields(), fnSpec, func.id);
      }
      throw e;
    }
  };

  public execute = async <MODEL>(
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<
      AxProgramForwardOptions<MODEL> & {
        traceId?: string;
        stopFunctionNames?: readonly string[];
      }
    >
  ): Promise<string> => {
    const result = await this.executeWithDetails<MODEL>(func, options);
    return result.formatted;
  };
}

export type AxInputFunctionType = (
  | AxFunction
  | {
      toFunction: () => AxFunction | AxFunction[];
    }
)[];

export const parseFunctions = (
  newFuncs: Readonly<AxInputFunctionType>,
  existingFuncs?: readonly AxFunction[]
): AxFunction[] => {
  if (newFuncs.length === 0) {
    return [...(existingFuncs ?? [])];
  }

  // biome-ignore lint/complexity/useFlatMap: cannot use flatMap here
  const functions = newFuncs
    .map((f) => {
      if ('toFunction' in f) {
        return f.toFunction();
      }
      return f;
    })
    .flat();

  for (const fn of functions.filter((v) => v.parameters)) {
    if (fn.parameters) {
      try {
        validateJSONSchema(fn.parameters);
      } catch (e) {
        if (e instanceof Error) {
          throw new Error(
            `Function '${fn.name}' parameters schema is invalid.\n` +
              `${e.message}\n` +
              'Tip: Arrays must include an "items" schema (e.g., { items: { type: "string" } } or items: { type: "object", properties: { ... } }).',
            { cause: e }
          );
        }
        throw e;
      }
    }
  }

  return [...(existingFuncs ?? []), ...functions];
};

type ProcessFunctionsArgs = {
  ai: Readonly<AxAIService>;
  functionList: Readonly<AxFunction[]>;
  functionCalls: readonly AxChatResponseFunctionCall[];
  mem: Readonly<AxMemory>;
  sessionId?: string;
  traceId?: string;
  span?: any;
  excludeContentFromTrace?: boolean;
  index: number;
  functionResultFormatter?: (result: unknown) => string;
  logger: AxLoggerFunction;
  debug: boolean;
  stopFunctionNames?: readonly string[];
};

export const processFunctions = async ({
  ai,
  functionList,
  functionCalls,
  mem,
  sessionId,
  traceId,
  span,
  excludeContentFromTrace,
  index,
  functionResultFormatter,
  logger,
  debug,
  stopFunctionNames,
}: Readonly<ProcessFunctionsArgs>) => {
  const funcProc = new AxFunctionProcessor(functionList);
  const functionsExecuted = new Set<string>();
  const stopMatches: Array<{
    func: Readonly<AxFunction>;
    args: unknown;
    result: unknown;
  }> = [];

  const findFunctionSpec = (name: string): Readonly<AxFunction> | undefined => {
    const normalize = (s: string) =>
      s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const target = normalize(name);
    let spec = functionList.find((v) => v.name === name);
    if (!spec) spec = functionList.find((v) => normalize(v.name) === target);
    return spec;
  };

  // Map each function call to a promise that resolves to the function result or null
  const promises = functionCalls.map((func) => {
    if (!func.id) {
      throw new Error(`Function ${func.name} did not return an ID`);
    }

    const tracer = ai.getOptions().tracer ?? axGlobals.tracer;

    if (!tracer) {
      return funcProc
        .executeWithDetails(func, {
          sessionId,
          ai,
          functionResultFormatter,
          traceId,
          stopFunctionNames,
        })
        .then(
          ({
            formatted,
            rawResult,
            parsedArgs,
          }: {
            formatted: string;
            rawResult: unknown;
            parsedArgs: unknown;
          }) => {
            functionsExecuted.add(func.name.toLowerCase());
            if (stopFunctionNames?.includes(func.name.toLowerCase())) {
              const spec = findFunctionSpec(func.name);
              if (spec) {
                stopMatches.push({
                  func: spec,
                  args: parsedArgs as any,
                  result: rawResult,
                });
              }
            }
            if (span) {
              const eventData: {
                name: string;
                args?: string;
                result?: string;
              } = {
                name: func.name,
              };
              if (!excludeContentFromTrace) {
                eventData.args = func.args;
                eventData.result = formatted ?? '';
              }
              span.addEvent('function.call', eventData);
            }
            return {
              result: formatted ?? '',
              role: 'function' as const,
              functionId: func.id,
              index,
            };
          }
        )
        .catch((e) => {
          if (!(e instanceof FunctionError)) {
            throw e;
          }
          const result = e.getFixingInstructions();
          if (span) {
            const errorEventData: {
              name: string;
              args?: string;
              message: string;
              fixing_instructions?: string;
            } = {
              name: func.name,
              message: e.toString(),
            };
            if (!excludeContentFromTrace) {
              errorEventData.args = func.args;
              errorEventData.fixing_instructions = result;
            }
            span.addEvent('function.error', errorEventData);
          }
          if (debug) {
            logFunctionError(e, index, result, logger);
          }
          return {
            functionId: func.id,
            isError: true,
            index,
            result,
            role: 'function' as const,
          };
        });
    }

    return tracer.startActiveSpan(
      `Tool: ${func.name}`,
      async (toolSpan: any) => {
        try {
          toolSpan?.setAttributes?.({
            'tool.name': func.name,
            'tool.mode': 'native',
            'function.id': func.id,
            'session.id': sessionId ?? '',
          });
          const {
            formatted,
            rawResult,
            parsedArgs,
          }: { formatted: string; rawResult: unknown; parsedArgs: unknown } =
            await funcProc.executeWithDetails(func, {
              sessionId,
              ai,
              functionResultFormatter,
              traceId: toolSpan?.spanContext?.().traceId ?? traceId,
              stopFunctionNames,
            });

          functionsExecuted.add(func.name.toLowerCase());
          if (stopFunctionNames?.includes(func.name.toLowerCase())) {
            const spec = findFunctionSpec(func.name);
            if (spec) {
              stopMatches.push({
                func: spec,
                args: parsedArgs as any,
                result: rawResult,
              });
            }
          }

          if (!excludeContentFromTrace) {
            toolSpan.addEvent('gen_ai.tool.message', {
              name: func.name,
              args: func.args,
              result: formatted ?? '',
            });
          } else {
            toolSpan.addEvent('gen_ai.tool.message', { name: func.name });
          }

          if (span) {
            const eventData: { name: string; args?: string; result?: string } =
              {
                name: func.name,
              };
            if (!excludeContentFromTrace) {
              eventData.args = func.args;
              eventData.result = formatted ?? '';
            }
            span.addEvent('function.call', eventData);
          }

          return {
            result: formatted ?? '',
            role: 'function' as const,
            functionId: func.id,
            index,
          };
        } catch (e) {
          toolSpan?.recordException?.(e as Error);
          if (e instanceof FunctionError) {
            const result = e.getFixingInstructions();
            const errorEventData: {
              name: string;
              args?: string;
              message: string;
              fixing_instructions?: string;
            } = {
              name: func.name,
              message: e.toString(),
            };
            if (!excludeContentFromTrace) {
              errorEventData.args = func.args;
              errorEventData.fixing_instructions = result;
            }
            toolSpan?.addEvent?.('function.error', errorEventData);

            if (debug) {
              logFunctionError(e, index, result, logger);
            }

            return {
              functionId: func.id,
              isError: true,
              index,
              result,
              role: 'function' as const,
            };
          }
          throw e;
        } finally {
          toolSpan?.end?.();
        }
      }
    );
  });

  // Wait for all promises to resolve
  const results = await Promise.all(promises);
  const functionResults: AxFunctionResult[] = (
    results as Array<AxFunctionResult | undefined>
  ).filter((r): r is AxFunctionResult => r !== undefined);

  mem.addFunctionResults(functionResults, sessionId);

  // Log successful function results if debug is enabled
  if (debug) {
    const successfulResults = functionResults.filter(
      (result: AxFunctionResult) => !result.isError
    );
    if (successfulResults.length > 0) {
      logFunctionResults(successfulResults, logger);
    }
  }

  if (functionResults.some((result) => result.isError)) {
    mem.addTag('error', sessionId);
  }

  if (stopMatches.length > 0) {
    throw new AxStopFunctionCallException(stopMatches);
  }

  return functionsExecuted;
};

export function parseFunctionCalls(
  ai: Readonly<AxAIService>,
  functionCalls: Readonly<AxChatResponseResult['functionCalls']>,
  _values: Record<string, unknown>,
  model?: string
): AxChatResponseFunctionCall[] | undefined {
  if (!functionCalls || functionCalls.length === 0) {
    return;
  }
  if (!ai.getFeatures(model).functions) {
    throw new Error('Functions are not supported by the AI service');
  }

  const funcs: AxChatResponseFunctionCall[] = functionCalls.map((f) => ({
    id: f.id,
    name: f.function.name,
    args: f.function.params as string,
  }));

  // for (const [i, f] of funcs.entries()) {
  //   values['functionName' + i] = f.name;
  //   values['functionArguments' + i] =
  //     typeof f.args === 'object' ? JSON.stringify(f.args) : f.args;
  // }
  return funcs;
}

type FunctionCall = AxChatRequest['functionCall'] | undefined;

/**
 * Utility function to parse a list of functions into AxFunction array
 */
export function createFunctionConfig(
  functionList?: AxInputFunctionType,
  definedFunctionCall?: FunctionCall,
  firstStep?: boolean,
  _options?: Readonly<AxProgramForwardOptions<any>>
): { functions: AxFunction[]; functionCall: FunctionCall } {
  const functionCall = definedFunctionCall;

  if (
    !firstStep &&
    (functionCall === 'required' || typeof functionCall === 'function')
  ) {
    return { functions: [], functionCall: undefined };
  }

  if (!functionList) {
    return { functions: [], functionCall: functionCall };
  }

  // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
  const functions = functionList
    .map((f) => {
      if ('toFunction' in f) {
        return f.toFunction();
      }
      return f;
    })
    .flat();

  return { functions, functionCall };
}
