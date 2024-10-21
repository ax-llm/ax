import type { AxGenOptions } from '../dsp/generate.js';
import type { AxGenIn, AxGenOut } from '../dsp/program.js';
import { AxSignature } from '../dsp/sig.js';

import { AxChainOfThought } from './cot.js';

export class AxReAct<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut
> extends AxChainOfThought<IN, OUT> {
  constructor(
    signature: Readonly<AxSignature | string>,
    options: Readonly<AxGenOptions>
  ) {
    if (!options?.functions || options.functions.length === 0) {
      throw new Error('No functions provided');
    }

    const fnNames = options.functions.map((f) => {
      if ('toFunction' in f) {
        return f.toFunction().name;
      }
      return f.name;
    });

    const funcList = fnNames.map((fname) => `'${fname}'`).join(', ');

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

    super(sig, options);
  }
}
