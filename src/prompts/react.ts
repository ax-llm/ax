import {
  ForwardResult,
  GenerateForwardOptions,
  GenerateOptions,
  IGenerate,
  Signature
} from '../dsp/index.js';
import { GenIn, GenOut } from '../dsp/prompt.js';
import { AITextFunction, FunctionProcessor } from '../text/functions.js';
import { Memory } from '../text/memory.js';
import { AIService } from '../text/types.js';

import { ChainOfThought } from './cot.js';

export class ReAct<IN extends GenIn, OUT extends GenOut>
  implements IGenerate<IN, OUT>
{
  private nativeFunctions: boolean;
  private funcProc: FunctionProcessor;
  private cot: ChainOfThought<
    IN,
    OUT & { functionName: string; functionArguments: string }
  >;

  constructor(
    ai: AIService,
    signature: Readonly<Signature | string>,
    options: Readonly<GenerateOptions>
  ) {
    if (!options?.functions || options.functions.length === 0) {
      throw new Error('No functions provided');
    }

    const functions = [
      ...options.functions,
      { name: 'task_done', description: 'Task is complete' }
    ];

    this.nativeFunctions = ai.getFeatures().functions;
    this.funcProc = new FunctionProcessor(functions);
    this.cot = new ChainOfThought(ai, signature, options);
    this.cot.updateSignature(this.updateSig(functions));
  }

  private updateSig =
    (functions: readonly AITextFunction[]) => (sig: Readonly<Signature>) => {
      const funcList = functions.map((f) => `'${f.name}'`).join(', ');

      sig.setDescription(
        `Use the provided functions ${funcList} to complete the task. Use function 'task_done' if the final result is found.`
      );

      // sig.addInputField({
      //   name: 'observation',
      //   description: 'Result value from executed function',
      //   isOptional: true,
      //   type: { name: 'string', isArray: true }
      // });

      sig.setOutputFields(
        sig.getOutputFields().map((v) => ({ ...v, isOptional: true }))
      );
    };

  public processFunction = async (
    res: Readonly<ForwardResult<OUT>>,
    options?: Readonly<GenerateForwardOptions>
  ): Promise<OUT | undefined> => {
    if (!res.functions || res.functions.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { functions: _skip1, ...result } = res;
      return result as OUT;
    }

    for (const func of res.functions) {
      if (func.name.indexOf('task_done') !== -1) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { functions: _skip1, ...result } = res;
        return result as OUT;
      }

      const fres = await this.funcProc.execute(func, {
        sessionId: options?.sessionId,
        traceId: options?.traceId
      });

      if (this.nativeFunctions && fres.id) {
        options?.mem?.add([
          {
            role: 'function' as const,
            content: fres.result ?? '',
            functionId: fres.id
          }
        ]);
      }
    }
    return;
  };

  public forward = async (
    values: IN,
    options?: Readonly<GenerateForwardOptions>
  ): Promise<OUT> => {
    const mem = options?.mem ?? new Memory();
    // const observation: string[] = [];

    for (let i = 0; i < (options?.maxSteps ?? 10); i++) {
      const res = await this.cot.forward(
        { ...values },
        { ...options, mem, skipSystemPrompt: i > 0 }
      );

      const result = await this.processFunction(res, { ...options, mem });
      if (result) {
        return result;
      }
    }
    throw new Error('Could not complete task within maximum allowed steps');
  };
}
