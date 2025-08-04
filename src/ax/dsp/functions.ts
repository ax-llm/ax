import { logFunctionError, logFunctionResults } from '../ai/debug.js';
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
    options?: Readonly<AxProgramForwardOptions<MODEL>>
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

    // Use the formatter from options or fall back to globals
    const formatter =
      options?.functionResultFormatter ?? axGlobals.functionResultFormatter;
    return formatter(res);
  };

  public execute = async <MODEL>(
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxProgramForwardOptions<MODEL>>
  ) => {
    const fnSpec = this.funcList.find(
      (v) => v.name.localeCompare(func.name) === 0
    );
    if (!fnSpec) {
      throw new Error(`Function not found: ${func.name}`);
    }
    if (!fnSpec.func) {
      throw new Error(`No handler for function: ${func.name}`);
    }

    // execute value function calls
    try {
      return await this.executeFunction<MODEL>(fnSpec, func, options);
    } catch (e) {
      if (e instanceof AxFunctionError) {
        throw new FunctionError(e.getFields(), fnSpec, func.id);
      }
      throw e;
    }
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
      validateJSONSchema(fn.parameters);
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
  span?: import('@opentelemetry/api').Span;
  excludeContentFromTrace?: boolean;
  index: number;
  functionResultFormatter?: (result: unknown) => string;
  logger: AxLoggerFunction;
};

export const processFunctions = async ({
  ai,
  functionList,
  functionCalls,
  mem,
  sessionId,
  span,
  excludeContentFromTrace,
  index,
  functionResultFormatter,
  logger,
}: Readonly<ProcessFunctionsArgs>) => {
  const funcProc = new AxFunctionProcessor(functionList);
  const functionsExecuted = new Set<string>();

  // Map each function call to a promise that resolves to the function result or null
  const promises = functionCalls.map((func) => {
    if (!func.id) {
      throw new Error(`Function ${func.name} did not return an ID`);
    }

    const promise: Promise<AxFunctionResult | undefined> = funcProc
      .execute(func, { sessionId, ai, functionResultFormatter })
      .then((functionResult) => {
        functionsExecuted.add(func.name.toLowerCase());

        // Add telemetry event for successful function call
        if (span) {
          const eventData: { name: string; args?: string; result?: string } = {
            name: func.name,
          };
          if (!excludeContentFromTrace) {
            eventData.args = func.args;
            eventData.result = functionResult ?? '';
          }
          span.addEvent('function.call', eventData);
        }

        return {
          result: functionResult ?? '',
          role: 'function' as const,
          functionId: func.id,
          index,
        };
      })
      .catch((e) => {
        if (!(e instanceof FunctionError)) {
          throw e;
        }
        const result = e.getFixingInstructions();

        // Add telemetry event for function error
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

        if (ai.getOptions().debug) {
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

    return promise;
  });

  // Wait for all promises to resolve
  const results = await Promise.all(promises);
  const functionResults = results.filter((result) => result !== undefined);

  mem.addFunctionResults(functionResults, sessionId);

  // Log successful function results if debug is enabled
  if (ai.getOptions().debug) {
    const successfulResults = functionResults.filter(
      (result) => !result.isError
    );
    if (successfulResults.length > 0) {
      logFunctionResults(successfulResults, logger);
    }
  }

  if (functionResults.some((result) => result.isError)) {
    mem.addTag('error', sessionId);
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
  options?: Readonly<AxProgramForwardOptions<any>>
): { functions: AxFunction[]; functionCall: FunctionCall } {
  const functionCall = definedFunctionCall;

  // Disable normal tool calling when signatureToolCalling is enabled
  if (options?.signatureToolCalling) {
    return { functions: [], functionCall: undefined };
  }

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
