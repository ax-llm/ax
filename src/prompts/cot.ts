import {
  Generate,
  type GenerateOptions,
  type Signature
} from '../dsp/index.js';
import type { GenIn } from '../dsp/prompt.js';
import type { AIService } from '../text/types.js';

export class ChainOfThought<IN extends GenIn, OUT> extends Generate<
  IN,
  OUT & { reason: string }
> {
  constructor(
    ai: AIService,
    signature: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    super(ai, signature, options);
    this.updateSignature(this.updateSig);
  }

  private updateSig = (sig: Readonly<Signature>) => {
    const outputs = sig
      .getOutputFields()
      .map((f) => `\`${f.name}\``)
      .join(', ');

    const description = `Let's think step by step in order to produce ${outputs}. We ...`;

    sig.addOutputField({
      name: 'reason',
      description
    });
  };
}
