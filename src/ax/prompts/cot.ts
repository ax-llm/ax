import { AxGen, type AxGenOptions } from '../dsp/generate.js'
import { AxSignature } from '../dsp/sig.js'
import type { AxGenIn, AxGenOut } from '../dsp/types.js'

export class AxChainOfThought<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> extends AxGen<IN, OUT & { reason: string }> {
  constructor(
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenOptions>
  ) {
    const sig = new AxSignature(signature)
    const description = `Let's work this out in a step by step way in order to ensure we have the right answer.`

    sig.setOutputFields([
      {
        name: 'reason',
        description,
      },
      ...sig.getOutputFields(),
    ])

    super(sig, options)
  }
}
