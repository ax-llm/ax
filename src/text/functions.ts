import Ajv, { JSONSchemaType } from 'ajv';

import { TextResponseFunctionCall } from '../ai/types.js';

import { parseResult } from './result.js';
import {
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  FunctionExec,
  PromptFunction
} from './types.js';

const ajv = new Ajv();

export class FunctionProcessor {
  private funcList: readonly PromptFunction[];

  constructor(funcList: readonly PromptFunction[]) {
    funcList.forEach((v) =>
      ajv.validateSchema(v.inputSchema as JSONSchemaType<unknown>)
    );
    this.funcList = funcList;
  }

  private executeFunction = async <T = unknown>(
    fn: Readonly<PromptFunction>,
    funcArgJSON: string,
    ai: AIService,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<FunctionExec> => {
    const extra = { ai, session: options };

    if (!fn.inputSchema) {
      const res = fn.func.length === 1 ? await fn.func(extra) : await fn.func();

      return {
        name: fn.name,
        result: JSON.stringify(res, null, 2)
      };
    }

    const funcArgs = await parseResult<T>(
      ai,
      options,
      funcArgJSON,
      false,
      fn.inputSchema as JSONSchemaType<T>
    );

    const res =
      fn.func.length === 2
        ? await fn.func(funcArgs, extra)
        : await fn.func(funcArgs);

    return {
      name: fn.name,
      args: funcArgs,
      result: JSON.stringify(res, null, 2)
    };
  };

  public processFunction = async (
    func: Readonly<TextResponseFunctionCall>,
    ai: AIService,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<FunctionExec> => {
    const fn = this.funcList.find((v) => v.name.localeCompare(func.name) === 0);

    let funcArgJSON = func.args;
    if (
      fn &&
      (fn.inputSchema as JSONSchemaType<object>)?.type === 'object' &&
      !funcArgJSON.startsWith('{') &&
      !funcArgJSON.startsWith('[')
    ) {
      funcArgJSON = `{${funcArgJSON}}`;
    }

    if (!fn) {
      throw new Error(`Function ${func.name} not found`);
    }

    // execute value function calls
    const funcExec = await this.executeFunction(fn, funcArgJSON, ai, options);

    // // signal error if no data returned
    // if (!funcExec.result || funcExec.result.length === 0) {
    //   funcExec.result = `No data returned by function`;
    // }
    return funcExec;
  };
}

export function buildFinalResultSchema<T>(
  schema: Readonly<JSONSchemaType<T>>
): PromptFunction {
  return {
    name: 'finalResult',
    description: 'Return the final result',
    inputSchema: schema as JSONSchemaType<{ value: T }>,
    func: async (arg0: T) => arg0
  };
}
