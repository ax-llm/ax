import type { AxAIService, AxFunction } from '../ai/types.js';
import { type AxGenerateOptions, AxSignature } from '../dsp/index.js';
import {
  type AxGenIn,
  type AxGenOut,
  type AxProgramDemos,
  type AxProgramExamples,
  type AxProgramForwardOptions,
  AxProgramWithSignature,
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
  implements AxAgentic
{
  private signature: AxSignature;
  private program: AxProgramWithSignature<IN, OUT>;

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
    this.signature = new AxSignature(signature);

    const funcs: AxFunction[] = [
      ...(functions ?? []),
      ...(agents?.map((a) => a.getFunction()) ?? [])
    ];

    const opt = {
      ...options,
      functions: funcs
    };

    this.program =
      funcs.length > 0
        ? new AxReAct<IN, OUT>(ai, this.signature, opt)
        : new AxChainOfThought<IN, OUT>(ai, this.signature, opt);

    if (!name || name.length < 5) {
      throw new Error(
        'Agent name must be at least 10 characters (more descriptive): ' + name
      );
    }

    if (!description || description.length < 20) {
      throw new Error(
        'Agent description must be at least 20 characters (explain in detail what the agent does): ' +
          description
      );
    }

    this.name = name;
    this.description = description;
    this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ');

    this.func = {
      name: toCamelCase(this.name),
      description: this.description,
      parameters: this.signature.toJSONSchema(),
      func: () => this.forward
    };

    for (const agent of agents ?? []) {
      this.program.register(agent);
    }
  }

  public setExamples(examples: Readonly<AxProgramExamples>) {
    this.program.setExamples(examples);
  }

  public setId(id: string) {
    this.program.setId(id);
  }

  public setParentId(parentId: string) {
    this.program.setParentId(parentId);
  }

  public getTraces() {
    return this.program.getTraces();
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    this.program.setDemos(demos);
  }

  public getUsage() {
    return this.program.getUsage();
  }

  public resetUsage() {
    this.program.resetUsage();
  }

  public getFunction(): AxFunction {
    return this.func;
  }

  public async forward(
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    if (!options?.tracer) {
      return await this.program.forward(values, options);
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
        const res = await this.program.forward(values, options);
        span.end();
        return res;
      }
    );
  }
}

function toCamelCase(inputString: string): string {
  // Split the string by any non-alphanumeric character (including underscores, spaces, hyphens)
  const words = inputString.split(/[^a-zA-Z0-9]/);

  // Map through each word, capitalize the first letter of each word except the first word
  const camelCaseString = words
    .map((word, index) => {
      // Lowercase the word to handle cases like uppercase letters in input
      const lowerWord = word.toLowerCase();

      // Capitalize the first letter of each word except the first one
      if (index > 0 && lowerWord && lowerWord[0]) {
        return lowerWord[0].toUpperCase() + lowerWord.slice(1);
      }

      return lowerWord;
    })
    .join('');

  return camelCaseString;
}
