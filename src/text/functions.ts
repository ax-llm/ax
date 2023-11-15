import Ajv, { JSONSchemaType } from 'ajv';

import { TextResponseFunctionCall } from '../ai/types.js';

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

  private executeFunction = async (
    fnSpec: Readonly<PromptFunction>,
    func: Readonly<TextResponseFunctionCall>,
    ai: AIService,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<FunctionExec> => {
    const extra = { ai, session: options };

    if (!fnSpec.func) {
      throw new Error(`Function handler for ${fnSpec.name} not implemented`);
    }

    if (!fnSpec.inputSchema) {
      const res =
        fnSpec.func.length === 1
          ? await fnSpec.func(extra)
          : await fnSpec.func();

      return {
        name: fnSpec.name,
        result: JSON.stringify(res, null, 2)
      };
    }

    const res =
      fnSpec.func.length === 2
        ? await fnSpec.func(func.args, extra)
        : await fnSpec.func(func.args);

    return {
      name: func.name,
      args: func.args,
      result: JSON.stringify(res, null, 2)
    };
  };

  public processFunction = async (
    func: Readonly<TextResponseFunctionCall>,
    ai: AIService,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<FunctionExec | undefined> => {
    const fnSpec = this.funcList.find(
      (v) => v.name.localeCompare(func.name) === 0
    );
    if (!fnSpec) {
      throw new Error(`Function ${func.name} not found`);
    }
    if (!fnSpec.func) {
      return;
    }

    // execute value function calls
    const funcExec = await this.executeFunction(fnSpec, func, ai, options);

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
