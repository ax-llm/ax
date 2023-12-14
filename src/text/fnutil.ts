import Ajv, { JSONSchemaType } from 'ajv';

import { TextResponseFunctionCall } from '../ai/types';
import { AITextRequestFunction } from '../tracing/types';

import { AIService } from './types';

const ajv = new Ajv();

export const validateFunctions = (
  funcList?: readonly Readonly<AITextRequestFunction>[]
): void =>
  funcList?.forEach((v) =>
    ajv.validateSchema(v.parameters as JSONSchemaType<unknown>)
  );

export const executeFunction = async (
  fnSpec: Readonly<AITextRequestFunction>,
  func: Readonly<TextResponseFunctionCall>,
  options: Readonly<{ ai: AIService; traceId?: string }>
): Promise<unknown> => {
  if (!fnSpec.func) {
    throw new Error(`Function handler for ${fnSpec.name} not implemented`);
  }

  if (!fnSpec.parameters) {
    const res =
      fnSpec.func.length === 1
        ? await fnSpec.func(options)
        : await fnSpec.func();

    return res;
  }

  const res =
    fnSpec.func.length === 2
      ? await fnSpec.func(func.args, options)
      : await fnSpec.func(func.args);

  return res;
};

export const processFunction = async (
  funcList: readonly Readonly<AITextRequestFunction>[],
  func: Readonly<TextResponseFunctionCall>,
  options: Readonly<{ ai: AIService; traceId?: string }>
): Promise<{ name: string; result: string } | undefined> => {
  const fnSpec = funcList.find((v) => v.name.localeCompare(func.name) === 0);
  if (!fnSpec) {
    throw new Error(`Function ${func.name} not found`);
  }
  if (!fnSpec.func) {
    return;
  }

  // execute value function calls
  const result = await executeFunction(fnSpec, func, options);

  // // signal error if no data returned
  // if (!funcExec.result || funcExec.result.length === 0) {
  //   funcExec.result = `No data returned by function`;
  // }
  return { name: fnSpec.name, result: JSON.stringify(result, null, 2) };
};
