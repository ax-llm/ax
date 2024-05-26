import type { GenerateOptions } from '../dsp/generate.js';
import {
  type GenIn,
  type GenOut,
  type ProgramForwardOptions
} from '../dsp/program.js';
import { Signature } from '../dsp/sig.js';
import type { AIService } from '../text/types.js';

import { ChainOfThought } from './cot.js';

export class ReAct<
  IN extends GenIn = GenIn,
  OUT extends GenOut = GenOut
> extends ChainOfThought<IN, OUT> {
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
  }

  override forward = async (
    values: IN,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<OUT & { reason: string }> => {
    return await super.forward(values, options);
  };
}
