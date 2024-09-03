import type { AxAIService } from '../ai/types.js';

import {
  AxGenerate,
  type AxGenerateOptions,
  type AxGenerateResult
} from './generate.js';
import type { AxGenIn, AxGenOut, AxProgramForwardOptions } from './program.js';
import type { AxSignature } from './sig.js';

export class AxGen<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenerateResult<AxGenOut> = AxGenerateResult<AxGenOut>
> extends AxGenerate<IN, OUT> {
  constructor(
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenerateOptions>
  ) {
    super(null as unknown as AxAIService, signature, options);
  }

  // @ts-expect-error changing the over ridden function type
  async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    return await super.forward(values, { ...options, ai });
  }
}
