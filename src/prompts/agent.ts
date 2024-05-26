import { type GenerateOptions, Signature } from '../dsp/index.js';
import {
  type GenIn,
  type GenOut,
  Program,
  type ProgramForwardOptions,
  type Tunable
} from '../dsp/program.js';
import { type AITextFunction } from '../text/index.js';
import type { AIService } from '../text/types.js';
import { SpanKind } from '../trace/index.js';

import { ChainOfThought } from './cot.js';
import { ReAct } from './react.js';

export interface AgentI extends Tunable {
  getFunction(): AITextFunction;
}

export type AgentOptions = Omit<GenerateOptions, 'functions' | 'functionCall'>;

export class Agent<IN extends GenIn, OUT extends GenOut>
  extends Program<IN, OUT>
  implements AgentI
{
  private gen: Program<IN, OUT>;

  private name: string;
  private description: string;
  private subAgentList?: string;

  constructor(
    ai: AIService,
    {
      name,
      description,
      signature,
      agents,
      functions
    }: Readonly<{
      name: string;
      description: string;
      signature: Signature | string;
      agents?: AgentI[];
      functions?: AITextFunction[];
    }>,
    options?: Readonly<AgentOptions>
  ) {
    super(signature);

    const funcs: AITextFunction[] = [
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
        ? new ReAct<IN, OUT>(ai, this.signature, opt)
        : new ChainOfThought<IN, OUT>(ai, this.signature, opt);

    this.name = name;
    this.description = description;
    this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ');

    this.register(this.gen);

    for (const agent of agents ?? []) {
      this.register(agent);
    }
  }

  public getFunction(): AITextFunction {
    const s = this.signature.toJSONSchema();
    return {
      name: this.name,
      description: this.description,
      parameters: s,
      func: () => this.forward
    };
  }

  public override async forward(
    values: IN,
    options?: Readonly<ProgramForwardOptions>
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
        kind: SpanKind.SERVER,
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
