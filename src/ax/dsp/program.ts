import type {
  AxAIService,
  AxChatResponse,
  AxModelConfig,
  AxRateLimiterFunction
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import type { AxTracer } from '../trace/index.js';

import { AxInstanceRegistry } from './registry.js';
import { AxSignature } from './sig.js';
import { mergeProgramUsage, validateValue } from './util.js';

export type AxFieldValue =
  | string
  | string[]
  | number
  | boolean
  | object
  | { mimeType: string; data: string }
  | { mimeType: string; data: string }[];

export type AxGenIn = Record<string, AxFieldValue>;
export type AxGenOut = Record<string, AxFieldValue>;

export type AxProgramTrace = {
  //   examples: Record<string, Value>[];
  trace: Record<string, AxFieldValue>;
  programId: string;
};

export type AxProgramDemos = {
  //   examples: Record<string, Value>[];
  traces: Record<string, AxFieldValue>[];
  programId: string;
};

export type AxProgramExamples = AxProgramDemos | AxProgramDemos['traces'];

export type AxProgramForwardOptions = {
  maxCompletions?: number;
  maxRetries?: number;
  maxSteps?: number;
  mem?: AxAIMemory;
  ai?: AxAIService;
  modelConfig?: AxModelConfig;
  model?: string;
  sessionId?: string;
  traceId?: string | undefined;
  tracer?: AxTracer;
  rateLimiter?: AxRateLimiterFunction;
  stream?: boolean;
  debug?: boolean;
};

export interface AxTunable {
  setExamples: (examples: Readonly<AxProgramExamples>) => void;
  setId: (id: string) => void;
  setParentId: (parentId: string) => void;
  getTraces: () => AxProgramTrace[];
  setDemos: (demos: readonly AxProgramDemos[]) => void;
}

export interface AxUsable {
  getUsage: () => AxProgramUsage[];
  resetUsage: () => void;
}

export type AxProgramUsage = AxChatResponse['modelUsage'] & {
  ai: string;
  model: string;
};

export class AxProgramWithSignature<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxTunable, AxUsable
{
  protected signature: AxSignature;
  protected sigHash: string;

  protected examples?: Record<string, AxFieldValue>[];
  protected demos?: Record<string, AxFieldValue>[];
  protected trace?: Record<string, AxFieldValue>;
  protected usage: AxProgramUsage[] = [];

  private key: { id: string; custom?: boolean };
  private children: AxInstanceRegistry<Readonly<AxTunable & AxUsable>>;

  constructor(signature: Readonly<AxSignature | string>) {
    this.signature = new AxSignature(signature);
    this.sigHash = this.signature?.hash();
    this.children = new AxInstanceRegistry();
    this.key = { id: this.constructor.name };
  }

  public getSignature() {
    return this.signature;
  }

  public register(prog: Readonly<AxTunable & AxUsable>) {
    if (this.key) {
      prog.setParentId(this.key.id);
    }
    this.children.register(prog);
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _arg0: IN,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented');
  }

  public setId(id: string) {
    this.key = { id, custom: true };
    for (const child of this.children) {
      child.setParentId(id);
    }
  }

  public setParentId(parentId: string) {
    if (!this.key.custom) {
      this.key.id = [parentId, this.key.id].join('/');
    }
  }

  public setExamples(examples: Readonly<AxProgramExamples>) {
    this._setExamples(examples);

    if (!('programId' in examples)) {
      return;
    }

    for (const child of this.children) {
      child.setExamples(examples);
    }
  }

  private _setExamples(examples: Readonly<AxProgramExamples>) {
    let traces: Record<string, AxFieldValue>[] = [];

    if ('programId' in examples && examples.programId === this.key.id) {
      traces = examples.traces;
    }

    if (Array.isArray(examples)) {
      traces = examples;
    }

    if (traces) {
      const sig = this.signature;
      const fields = [...sig.getInputFields(), ...sig.getOutputFields()];

      this.examples = traces.map((e) => {
        const res: Record<string, AxFieldValue> = {};
        for (const f of fields) {
          const value = e[f.name];
          if (value) {
            validateValue(f, value);
            res[f.name] = value;
          }
        }
        return res;
      });
    }
  }

  public getTraces(): AxProgramTrace[] {
    let traces: AxProgramTrace[] = [];

    if (this.trace) {
      traces.push({ trace: this.trace, programId: this.key.id });
    }

    for (const child of this.children) {
      const _traces = child.getTraces();
      traces = [...traces, ..._traces];
    }
    return traces;
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])];

    for (const child of this.children) {
      const cu = child.getUsage();
      usage = [...usage, ...cu];
    }
    return mergeProgramUsage(usage);
  }

  public resetUsage() {
    this.usage = [];
    for (const child of this.children) {
      child.resetUsage();
    }
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    this.demos = demos
      .filter((v) => v.programId === this.key.id)
      .map((v) => v.traces)
      .flat();

    for (const child of this.children) {
      child.setDemos(demos);
    }
  }
}

export class AxProgram<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxTunable, AxUsable
{
  protected trace?: Record<string, AxFieldValue>;
  protected usage: AxProgramUsage[] = [];

  private key: { id: string; custom?: boolean };
  private children: AxInstanceRegistry<Readonly<AxTunable & AxUsable>>;

  constructor() {
    this.children = new AxInstanceRegistry();
    this.key = { id: this.constructor.name };
  }

  public register(prog: Readonly<AxTunable & AxUsable>) {
    if (this.key) {
      prog.setParentId(this.key.id);
    }
    this.children.register(prog);
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _arg0: IN,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented');
  }

  public setId(id: string) {
    this.key = { id, custom: true };
    for (const child of this.children) {
      child.setParentId(id);
    }
  }

  public setParentId(parentId: string) {
    if (!this.key.custom) {
      this.key.id = [parentId, this.key.id].join('/');
    }
  }

  public setExamples(examples: Readonly<AxProgramExamples>) {
    if (!('programId' in examples)) {
      return;
    }

    for (const child of this.children) {
      child.setExamples(examples);
    }
  }

  public getTraces(): AxProgramTrace[] {
    let traces: AxProgramTrace[] = [];

    if (this.trace) {
      traces.push({ trace: this.trace, programId: this.key.id });
    }

    for (const child of this.children) {
      const _traces = child.getTraces();
      traces = [...traces, ..._traces];
    }
    return traces;
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])];

    for (const child of this.children) {
      const cu = child.getUsage();
      usage = [...usage, ...cu];
    }
    return mergeProgramUsage(usage);
  }

  public resetUsage() {
    this.usage = [];
    for (const child of this.children) {
      child.resetUsage();
    }
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    for (const child of this.children) {
      child.setDemos(demos);
    }
  }
}
