import { readFileSync } from 'fs';

import type {
  AxAIService,
  AxChatResponse,
  AxModelConfig
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import type { AxTracer } from '../trace/index.js';

import { AxInstanceRegistry } from './registry.js';
import { mergeProgramUsage } from './util.js';

export type AxFieldValue = string | string[] | number | boolean | object;

export type AxGenIn = Record<string, AxFieldValue>;
export type AxGenOut = Record<string, AxFieldValue>;

export type AxProgramTrace = {
  //   examples: Record<string, Value>[];
  trace: Record<string, AxFieldValue>;
  key: string;
};

export type AxProgramDemos = {
  //   examples: Record<string, Value>[];
  traces: Record<string, AxFieldValue>[];
  key: string;
};

export type AxProgramForwardOptions = {
  maxCompletions?: number;
  maxRetries?: number;
  maxSteps?: number;
  mem?: AxAIMemory;
  ai?: AxAIService;
  modelConfig?: AxModelConfig;
  sessionId?: string;
  traceId?: string | undefined;
  tracer?: AxTracer;
  stream?: boolean;
  debug?: boolean;
};

export interface AxTunable {
  setExamples: (examples: Readonly<Record<string, AxFieldValue>[]>) => void;
  setTrace: (trace: Record<string, AxFieldValue>) => void;
  updateKey: (parentKey: string) => void;
  getTraces: () => AxProgramTrace[];
  setDemos: (demos: readonly AxProgramDemos[]) => void;
  loadDemos: (filename: string) => void;
}

export interface AxUsable {
  getUsage: () => AxProgramUsage[];
  resetUsage: () => void;
}

export type AxProgramUsage = AxChatResponse['modelUsage'] & {
  ai: string;
  model: string;
};

export class AxProgram<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxTunable, AxUsable
{
  private key: string;
  private reg: AxInstanceRegistry<Readonly<AxTunable & AxUsable>>;

  protected examples?: Record<string, AxFieldValue>[];
  protected demos?: Record<string, AxFieldValue>[];
  protected trace?: Record<string, AxFieldValue>;
  protected usage: AxProgramUsage[] = [];

  constructor() {
    this.reg = new AxInstanceRegistry();
    this.key = this.constructor.name;
  }

  public register(prog: Readonly<AxTunable & AxUsable>) {
    if (this.key) {
      prog.updateKey(this.key);
    }
    this.reg.register(prog);
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _arg0: IN,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented');
  }

  public setExamples(examples: Readonly<Record<string, AxFieldValue>[]>) {
    for (const inst of this.reg) {
      inst.setExamples(examples);
    }
  }

  public setTrace(trace: Record<string, AxFieldValue>) {
    this.trace = trace;
  }

  public updateKey(parentKey: string) {
    this.key = [parentKey, this.key].join('/');
  }

  public getTraces(): AxProgramTrace[] {
    let traces: AxProgramTrace[] = [];

    if (this.trace) {
      traces.push({
        trace: this.trace,
        // examples: this.examples ?? [],
        key: this.key
      });
    }

    for (const inst of this.reg) {
      const _traces = inst.getTraces();
      traces = [...traces, ..._traces];
    }
    return traces;
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])];

    for (const inst of this.reg) {
      const cu = inst.getUsage();
      usage = [...usage, ...cu];
    }
    return mergeProgramUsage(usage);
  }

  public resetUsage() {
    this.usage = [];
    for (const inst of this.reg) {
      inst.resetUsage();
    }
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    const ourDemos = demos.find((v) => v.key === this.key);
    this.demos = ourDemos?.traces;

    for (const inst of this.reg) {
      inst.setDemos(demos);
    }
  }

  public loadDemos(filename: string) {
    const buf = readFileSync(filename, 'utf-8');
    this.setDemos(JSON.parse(buf));
  }
}
