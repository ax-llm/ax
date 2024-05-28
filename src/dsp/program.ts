import { readFileSync } from 'fs';

import type { TextModelConfig } from '../ai/types.js';
import type { AIMemory, AIService } from '../text/types.js';
import type { Tracer } from '../trace/index.js';

import { InstanceRegistry } from './registry.js';
import { type Field } from './sig.js';

export type Value = string | string[] | number | boolean | object;

export type GenIn = Record<string, Value>;
export type GenOut = Record<string, Value>;

export type ProgramTrace = {
  //   examples: Record<string, Value>[];
  trace: Record<string, Value>;
  key: string;
};

export type ProgramDemos = {
  //   examples: Record<string, Value>[];
  traces: Record<string, Value>[];
  key: string;
};

export type ProgramForwardOptions = {
  maxCompletions?: number;
  maxRetries?: number;
  maxSteps?: number;
  mem?: AIMemory;
  ai?: AIService;
  modelConfig?: TextModelConfig;
  sessionId?: string;
  traceId?: string | undefined;
  tracer?: Tracer;
};

export interface ITunable {
  setExamples: (examples: Readonly<Record<string, Value>[]>) => void;
  setTrace: (trace: Record<string, Value>) => void;
  updateKey: (parentKey: string) => void;
  getTraces: () => ProgramTrace[];
  setDemos: (demos: readonly ProgramDemos[]) => void;
  loadDemos: (filename: string) => void;
}

export class Program<IN extends GenIn, OUT extends GenOut> implements ITunable {
  private key: string;
  private reg: InstanceRegistry<Readonly<ITunable>>;

  protected examples?: Record<string, Value>[];
  protected demos?: Record<string, Value>[];
  protected trace?: Record<string, Value>;

  constructor() {
    this.reg = new InstanceRegistry();
    this.key = this.constructor.name;
  }

  public register(prog: Readonly<ITunable>) {
    if (this.key) {
      prog.updateKey(this.key);
    }
    this.reg.register(prog);
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _arg0: IN,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<ProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented');
  }

  public setExamples(examples: Readonly<Record<string, Value>[]>) {
    for (const inst of this.reg) {
      inst.setExamples(examples);
    }
  }

  public setTrace(trace: Record<string, Value>) {
    this.trace = trace;
  }

  public updateKey(parentKey: string) {
    this.key = [parentKey, this.key].join('/');
  }

  public getTraces(): ProgramTrace[] {
    let traces: ProgramTrace[] = [];

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

  public setDemos(demos: readonly ProgramDemos[]) {
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

export const validateValue = (
  field: Readonly<Field>,
  value: Readonly<Value>
): void => {
  const ft = field.type ?? { name: 'string', isArray: false };

  const validateSingleValue = (
    expectedType: string,
    val: Readonly<Value>
  ): boolean => {
    switch (expectedType) {
      case 'string':
        return typeof val === 'string';
      case 'number':
        return typeof val === 'number';
      case 'boolean':
        return typeof val === 'boolean';
      default:
        return false; // Unknown or unsupported type
    }
  };

  let isValid = true;
  if (ft.isArray) {
    if (!Array.isArray(value)) {
      isValid = false;
    } else {
      for (const item of value) {
        if (!validateSingleValue(ft.name, item)) {
          isValid = false;
          break;
        }
      }
    }
  } else {
    isValid = validateSingleValue(ft.name, value);
  }

  if (!isValid) {
    throw new Error(
      `Validation failed: Expected '${field.name}' to be a ${ft.isArray ? 'an array of ' : ''}${
        ft.name
      } instead got '${value}'`
    );
  }
};
