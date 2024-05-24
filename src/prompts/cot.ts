import { Generate, type GenerateOptions } from '../dsp/generate.js';
import type { GenIn, GenOut } from '../dsp/program.js';
import { Signature } from '../dsp/sig.js';
import type { AIService } from '../text/types.js';

export class ChainOfThought<
  IN extends GenIn = GenIn,
  OUT extends GenOut = GenOut
> extends Generate<IN, OUT & { reason: string }> {
  constructor(
    ai: AIService,
    signature: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    const sig = new Signature(signature);
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
