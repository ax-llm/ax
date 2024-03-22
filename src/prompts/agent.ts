import {
  type GenerateI,
  type GenerateOptions,
  Signature
} from '../dsp/index.js';
import { GenIn, GenOut } from '../dsp/prompt.js';
import { AITextFunction, ChainOfThought } from '../index.js';
import type { AIService } from '../text/types.js';

import { ReAct } from './react.js';

export interface AgentI {
  getFunction(): AITextFunction;
}

type AgentOptions = Omit<GenerateOptions, 'functions' | 'functionCall'>;

export class Agent<IN extends GenIn, OUT extends GenOut>
  implements AgentI, GenerateI<IN, OUT>
{
  private name: string;
  private description: string;
  private sig: Signature;
  private react: GenerateI<IN, OUT>;

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
    this.name = name;
    this.description = description;
    this.sig = new Signature(signature);

    const funcs: AITextFunction[] = [
      ...(functions ?? []),
      ...(agents?.map((a) => a.getFunction()) ?? [])
    ];

    const opt = {
      promptTemplate: options?.promptTemplate,
      asserts: options?.asserts,
      functions: funcs
    };

    this.react =
      funcs.length > 0
        ? new ReAct(ai, this.sig, opt)
        : new ChainOfThought(ai, this.sig, opt);
  }

  public getFunction = () => {
    const s = this.sig.toJSONSchema();
    return {
      name: this.name,
      description: this.description,
      parameters: s,
      func: this.forward
    };
  };

  public forward = async (values: IN): Promise<OUT> => {
    return await this.react.forward(values);
  };
}
