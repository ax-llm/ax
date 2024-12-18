import type { AxAIService, AxFunction } from '../ai/types.js';
import { AxGen, type AxGenOptions, AxSignature } from '../dsp/index.js';
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

export interface AxAgentic extends AxTunable, AxUsable {
  getFunction(): AxFunction;
}

export type AxAgentOptions = Omit<AxGenOptions, 'functions'>;

export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic
{
  private ai?: AxAIService;
  private signature: AxSignature;
  private program: AxProgramWithSignature<IN, OUT>;
  private agents?: AxAgentic[];

  private name: string;
  private description: string;
  private subAgentList?: string;
  private func: AxFunction;

  constructor(
    {
      ai,
      name,
      description,
      signature,
      agents,
      functions
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      name: string;
      description: string;
      signature: AxSignature | string;
      agents?: AxAgentic[];
      functions?: AxFunction[];
    }>,
    options?: Readonly<AxAgentOptions>
  ) {
    this.ai = ai;
    this.agents = agents;

    this.signature = new AxSignature(signature);
    this.signature.setDescription(description);
    this.signature.setOutputFields([
      {
        name: 'taskPlan',
        description:
          "A detailed plan to execute to achieve the agent's goal using the provided functions."
      },
      ...this.signature.getOutputFields()
    ]);

    const funcs: AxFunction[] = [
      ...(functions ?? []),
      ...(agents?.map((a) => a.getFunction()) ?? [])
    ];

    const opt = { ...options, functions: funcs };
    this.program = new AxGen<IN, OUT>(this.signature, opt);

    if (!name || name.length < 5) {
      throw new Error(
        `Agent name must be at least 10 characters (more descriptive): ${name}`
      );
    }

    if (!description || description.length < 20) {
      throw new Error(
        `Agent description must be at least 20 characters (explain in detail what the agent does): ${description}`
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
    const boundFunc = this.forward.bind(this);

    // Create a wrapper function that excludes the 'ai' parameter
    const wrappedFunc = (
      values: IN,
      options?: Readonly<AxProgramForwardOptions>
    ) => {
      const ai = this.ai ?? options?.ai;
      if (!ai) {
        throw new Error('AI service is required to run the agent');
      }
      return boundFunc(ai, values, options);
    };

    return {
      ...this.func,
      func: wrappedFunc
    };
  }

  public async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    const _ai = this.ai ?? ai;

    const funcs: AxFunction[] = [
      ...(options?.functions ?? []),
      ...(this.agents?.map((a) => a.getFunction()) ?? [])
    ];

    const opt = options;

    if (funcs.length > 0) {
      const opt = { ...options, functions: funcs };
      this.program = new AxGen<IN, OUT>(this.signature, opt);
    }

    if (!options?.tracer) {
      return await this.program.forward(_ai, values, opt);
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
        const res = await this.program.forward(_ai, values, opt);
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
