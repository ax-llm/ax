import type { AxAIService } from '../ai/index.js';
import type { AxGenerateOptions } from '../dsp/generate.js';
import type { AxGenIn, AxGenOut } from '../dsp/program.js';
import { AxSignature } from '../dsp/sig.js';

import { AxChainOfThought } from './cot.js';

export class AxReAct<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut
> extends AxChainOfThought<IN, OUT> {
  constructor(
    ai: AxAIService,
    signature: Readonly<AxSignature | string>,
    options: Readonly<AxGenerateOptions>
  ) {
    if (!options?.functions || options.functions.length === 0) {
      throw new Error('No functions provided');
    }

    const functions = [...options.functions];
    const funcList = functions.map((f) => `'${f.name}'`).join(', ');

    const sig = new AxSignature(signature);
    sig.setDescription(
      `Use the provided functions ${funcList} to complete the task and return the result if any.`
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
}
