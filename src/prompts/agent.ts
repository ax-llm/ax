import {
  type GenerateI,
  type GenerateOptions,
  Signature
} from '../dsp/index.js';
import { GenIn, GenOut } from '../dsp/prompt.js';
import { AITextFunction } from '../index.js';
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
  private react: ReAct<IN, OUT>;

  constructor(
    ai: AIService,
    {
      name,
      description,
      signature,
      otherAgents
    }: Readonly<{
      name: string;
      description: string;
      signature: Signature | string;
      otherAgents: AgentI[];
    }>,
    options: Readonly<AgentOptions>
  ) {
    this.name = name;
    this.description = description;
    this.sig = new Signature(signature);

    const functions: AITextFunction[] = otherAgents.map((a) => a.getFunction());

    this.react = new ReAct(ai, this.sig, {
      promptTemplate: options?.promptTemplate,
      asserts: options?.asserts,
      functions
    });
  }

  public getFunction = () => {
    const s = this.sig.toJSONSchema();
    return {
      name: this.name,
      description: this.description,
      properties: s.properties,
      func: this.forward
    };
  };

  public forward = async (values: IN): Promise<OUT> => {
    return await this.react.forward(values);
  };
}
