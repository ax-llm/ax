import {
  AIGenerateTextExtraOptions,
  AIGenerateTextResponse,
  AIMemory,
  AITokenUsage,
  PromptFunction,
} from './types.js';
import { log, stringToObject } from './util.js';

const functionCallRe = /(\w+)\((.*)\)/s;
const queryPrefix = '\nObservation: ';

const executeFunction = async (
  funcInfo: PromptFunction,
  funcArgJSON: string
): Promise<{ value?: string; error?: string }> => {
  let value;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value = stringToObject<any>(funcArgJSON, funcInfo.inputSchema);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const res = JSON.stringify(await funcInfo.func(value), null, '\t');
  return { value: res };
};

export const processFunction = async (
  functions: readonly PromptFunction[],
  mem: AIMemory,
  res: Readonly<AIGenerateTextResponse<string>>,
  { sessionID, debug = false }: Readonly<AIGenerateTextExtraOptions>
): Promise<{ done: boolean; usage: AITokenUsage[] }> => {
  let funcName = '';
  let funcArgs = '';
  let v: string[] | null;

  const val = res.value();

  if ((v = functionCallRe.exec(val)) !== null) {
    funcName = v[1].trim();
    funcArgs = v[2].trim();
  }

  if (funcName === 'finalResult') {
    mem.add(val, sessionID);
    res.values[0].text = funcArgs;
    return { done: true, usage: [] };
  }

  let funcResult;
  const func = functions.find((v) => v.name === funcName);

  if (func) {
    const result = await executeFunction(func, funcArgs);

    if (result.error) {
      funcResult = `Fix error and repeat action: ${result.error}`;
    } else {
      funcResult = result.value;
    }
  }

  if (!funcResult || funcResult.length === 0) {
    funcResult = `No data returned by function, fix and repeat`;
  }

  if (debug) {
    log(`> ${funcName}(${funcArgs}): ${funcResult}`, 'cyan');
  }

  const mval = ['\n', val, queryPrefix, funcResult];
  mem.add(mval.join(''), sessionID);

  return { done: false, usage: res.usage };
};

export const buildFunctionsPrompt = (
  functions: readonly PromptFunction[]
): string => {
  const funcList = functions.map((v) => ({
    name: v.name,
    description: v.description,
    parameters: v.inputSchema,
  }));

  const functionsJSON = JSON.stringify(funcList, null, '\t');

  return `
Functions:
${functionsJSON}

Solve the below task. Think step-by-step using the functions above.

Format:
Thought: Consider what to do.
Function Call: functionName(arguments)
Observation: Function output
Thought: I now have additional information.
Repeat the previous four steps as necessary.

Thought: I have the final answer.
Function Call: finalResult(arguments)

Task:`;
};
