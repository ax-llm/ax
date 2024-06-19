import type { AxAIService, AxFunction } from '../ai/types.js';
import { type AxGenerateOptions, AxSignature } from '../dsp/index.js';
import {
  type AxGenIn,
  type AxGenOut,
  AxProgram,
  type AxProgramForwardOptions,
  type AxTunable,
  type AxUsable
} from '../dsp/program.js';
import { AxSpanKind } from '../trace/index.js';

import { AxChainOfThought } from './cot.js';
import { AxReAct } from './react.js';

export interface AxAgentic extends AxTunable, AxUsable {
  getFunction(): AxFunction;
}

export type AxAgentOptions = Omit<
  AxGenerateOptions,
  'functions' | 'functionCall'
>;

export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgram<IN, OUT>
  implements AxAgentic
{
  private gen: AxProgram<IN, OUT>;

  private name: string;
  private description: string;
  private subAgentList?: string;
  private func: AxFunction;

  constructor(
    ai: AxAIService,
    {
      name,
      description,
      signature,
      agents,
      functions
    }: Readonly<{
      name: string;
      description: string;
      signature: AxSignature | string;
      agents?: AxAgentic[];
      functions?: AxFunction[];
    }>,
    options?: Readonly<AxAgentOptions>
  ) {
    super();

    const sig = new AxSignature(signature);

    const funcs: AxFunction[] = [
      ...(functions ?? []),
      ...(agents?.map((a) => a.getFunction()) ?? [])
    ];

    const opt = {
      promptTemplate: options?.promptTemplate,
      asserts: options?.asserts,
      functions: funcs
    };

    this.gen =
      funcs.length > 0
        ? new AxReAct<IN, OUT>(ai, sig, opt)
        : new AxChainOfThought<IN, OUT>(ai, sig, opt);

    this.name = name;
    this.description = description;
    this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ');
    this.func = {
      name: this.name,
      description: this.description,
      parameters: sig.toJSONSchema(),
      func: () => this.forward
    };

    this.register(this.gen);

    for (const agent of agents ?? []) {
      this.register(agent);
    }
  }

  public getFunction(): AxFunction {
    return this.func;
  }

  public override async forward(
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    if (!options?.tracer) {
      return await this.gen.forward(values, options);
    }

    const attributes = {
      ['agent.name']: this.name,
      ['agent.description']: this.description,
      ['agent.subAgents']: this.subAgentList ?? 'none'
    };

    return await options?.tracer.startActiveSpan(
      'Agent',
      {
        kind: AxSpanKind.SERVER,
        attributes
      },
      async (span) => {
        const res = await this.gen.forward(values, options);
        span.end();
        return res;
      }
    );
  }
}
