import { type TextResponseFunctionCall } from '../ai/types.js';
import type { GenerateOptions, GenerateResult } from '../dsp/generate.js';
import {
  type GenIn,
  type GenOut,
  type ProgramForwardOptions
} from '../dsp/program.js';
import { Signature } from '../dsp/sig.js';
import { FunctionProcessor } from '../text/functions.js';
import { Memory } from '../text/memory.js';
import type { AIService } from '../text/types.js';

import { ChainOfThought } from './cot.js';

export class ReAct<
  IN extends GenIn = GenIn,
  OUT extends GenOut = GenOut
> extends ChainOfThought<IN, OUT> {
  private nativeFunctions: boolean;
  private funcProc: FunctionProcessor;

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

    const funcList = functions.map((f) => `'${f.name}'`).join(', ');

    const sig = new Signature(signature);
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

    super(ai, sig, options);

    this.nativeFunctions = ai.getFeatures().functions;
    this.funcProc = new FunctionProcessor(functions);
  }

  public processFunction = async (
    res: Readonly<GenerateResult<OUT>>,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<(OUT & { reason: string }) | undefined> => {
    if (!res.functions || res.functions.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { functions: _skip1, ...result } = res;
      return result as OUT & { reason: string };
    }

    for (const func of res.functions as TextResponseFunctionCall[]) {
      if (func.name.indexOf('task_done') !== -1) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { functions: _skip1, ...result } = res;
        return result as OUT & { reason: string };
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

  override forward = async (
    values: IN,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<OUT & { reason: string }> => {
    const mem = options?.mem ?? new Memory();
    // const observation: string[] = [];

    for (let i = 0; i < (options?.maxSteps ?? 10); i++) {
      const res = await super.forward(
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
