import type { AxAIService } from '../ai/types.js';
import { AxGenerate, type AxGenerateOptions } from '../dsp/generate.js';
import type { AxGenIn, AxGenOut } from '../dsp/program.js';
import { AxSignature } from '../dsp/sig.js';

export class AxChainOfThought<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut
> extends AxGenerate<IN, OUT & { reason: string }> {
  constructor(
    ai: AxAIService,
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenerateOptions>
  ) {
    const sig = new AxSignature(signature);
    const description = `Let's work this out in a step by step way in order to ensure we have the right answer.`;

    sig.setOutputFields([
      {
        name: 'reason',
        description
      },
      ...sig.getOutputFields()
    ]);

    super(ai, sig, options);
  }
}
