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
    const fnNames = options.functions?.map((f) => {
      if ('toFunction' in f) {
        return f.toFunction().name;
      }
      return f.name;
    });

    const funcList = fnNames?.map((fname) => `'${fname}'`).join(', ');

    const sig = new AxSignature(signature);

    if (funcList && funcList.length > 0) {
      sig.setDescription(
        `Use the following functions ${funcList} to complete the task and return the result. The functions must be used to resolve the final result values`
      );
    }

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
