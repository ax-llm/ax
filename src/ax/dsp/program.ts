import type { ZodTypeAny } from 'zod';

import type { AxOptimizedProgram } from './optimizer.js';
import { AxInstanceRegistry } from './registry.js';
import { AxSignature } from './sig.js';
import type {
  AxFieldValue,
  AxProgramDemos,
  AxProgramExamples,
  AxProgramOptions,
  AxProgramTrace,
  AxProgramUsage,
  AxSetExamplesOptions,
  AxTunable,
  AxUsable,
} from './types.js';

import { mergeProgramUsage, validateValue } from './util.js';
import { isZodSchema } from '../zod/util.js';
import type { AxZodSignatureOptions } from '../zod/types.js';

export class AxProgram<IN, OUT> implements AxUsable, AxTunable<IN, OUT> {
  protected signature: AxSignature;
  protected sigHash: string;

  protected examples?: OUT[];
  protected examplesOptions?: AxSetExamplesOptions;
  protected demos?: OUT[];
  protected trace?: OUT;
  protected usage: AxProgramUsage[] = [];
  protected traceLabel?: string;

  private key: { id: string; custom?: boolean };
  private children: AxInstanceRegistry<Readonly<AxTunable<IN, OUT>>, IN, OUT>;
  private zodOptions?: AxZodSignatureOptions;

  constructor(
    signature: ConstructorParameters<typeof AxSignature>[0] | ZodTypeAny,
    options?: Readonly<AxProgramOptions>
  ) {
    this.zodOptions = options?.zod;
    const isZod = isZodSchema(signature);
    this.signature = this.resolveSignature(signature, this.zodOptions);

    if (options?.description) {
      this.signature.setDescription(options.description);
    }

    if (options?.traceLabel) {
      this.traceLabel = options.traceLabel;
    }

    // Only validate if signature is provided
    if (!isZod && signature) {
      this.signature.validate();
    }

    this.sigHash = this.signature?.hash();
    this.children = new AxInstanceRegistry();
    this.key = { id: this.signature.hash() };
  }

  private resolveSignature(
    signature: ConstructorParameters<typeof AxSignature>[0] | ZodTypeAny,
    zodOptions?: AxZodSignatureOptions
  ): AxSignature {
    if (isZodSchema(signature)) {
      return AxSignature.fromZod(signature, zodOptions);
    }

    return new AxSignature(signature);
  }

  public getSignature(): AxSignature {
    return new AxSignature(this.signature);
  }

  public setSignature(
    signature: ConstructorParameters<typeof AxSignature>[0] | ZodTypeAny,
    options?: AxZodSignatureOptions
  ): void {
    if (options) {
      this.zodOptions = options;
    }

    const isZod = isZodSchema(signature);
    this.signature = this.resolveSignature(signature, this.zodOptions);

    // Validate the new signature if it's provided
    if (!isZod && signature) {
      this.signature.validate();
    }

    // Update the signature hash and key
    this.updateSignatureHash();
  }

  public setDescription(description: string) {
    this.signature.setDescription(description);
    this.updateSignatureHash();
  }

  private updateSignatureHash() {
    this.sigHash = this.signature.hash();
    this.key = { id: this.signature.hash() };
  }

  public register(prog: Readonly<AxTunable<IN, OUT> & AxUsable>) {
    if (this.key) {
      prog.setParentId(this.key.id);
    }
    this.children.register(prog);
  }

  public setId(id: string) {
    this.key = { id, custom: true };
    for (const child of Array.from(this.children)) {
      child?.setParentId(id);
    }
  }

  public setParentId(parentId: string) {
    if (!this.key.custom) {
      this.key.id = [parentId, this.key.id].join('/');
    }
  }

  public setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    this._setExamples(examples, options);

    if (!('programId' in examples)) {
      return;
    }

    for (const child of Array.from(this.children)) {
      child?.setExamples(examples, options);
    }
  }

  private _setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    let traces: Record<string, AxFieldValue>[] = [];

    if ('programId' in examples && examples.programId === this.key.id) {
      traces = examples.traces as any;
    }

    if (Array.isArray(examples)) {
      traces = examples as any;
    }

    if (traces) {
      this.examplesOptions = options;
      const sig = this.signature;
      const fields = [...sig.getInputFields(), ...sig.getOutputFields()];

      this.examples = traces.map((e) => {
        const res: Record<string, AxFieldValue> = {};
        for (const f of fields) {
          const value = e[f.name];
          if (value !== undefined) {
            // Only validate the type of fields that are actually set
            // Allow any field to be missing regardless of whether it's required
            validateValue(f, value);
            res[f.name] = value;
          }
        }
        return res;
      }) as OUT[];
    }
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    let traces: AxProgramTrace<IN, OUT>[] = [];

    if (this.trace) {
      traces.push({ trace: this.trace as OUT & IN, programId: this.key.id });
    }

    for (const child of Array.from(this.children)) {
      const Traces = child?.getTraces();
      traces = [...traces, ...(Traces ?? [])];
    }
    return traces;
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])];

    for (const child of Array.from(this.children)) {
      const cu = child?.getUsage();
      usage = [...usage, ...(cu ?? [])];
    }
    return mergeProgramUsage(usage);
  }

  public resetUsage() {
    this.usage = [];
    for (const child of Array.from(this.children)) {
      child?.resetUsage();
    }
  }

  public setDemos(demos: readonly AxProgramDemos<IN, OUT>[]) {
    // Check if this program has children and if its programId is not found in demos
    const hasChildren = Array.from(this.children).length > 0;
    const hasMatchingDemo = demos.some(
      (demo) => demo.programId === this.key.id
    );

    if (hasChildren && !hasMatchingDemo) {
      throw new Error(
        `Program with id '${this.key.id}' has children but no matching programId found in demos`
      );
    }

    // biome-ignore lint/complexity/useFlatMap: it can't
    this.demos = demos
      .filter((v) => v.programId === this.key.id)
      .map((v) => v.traces)
      .flat();

    for (const child of Array.from(this.children)) {
      child?.setDemos(demos);
    }
  }

  /**
   * Apply optimized configuration to this program
   * @param optimizedProgram The optimized program configuration to apply
   */
  public applyOptimization(optimizedProgram: AxOptimizedProgram<OUT>): void {
    optimizedProgram.applyTo(this as any);

    // Propagate to children
    for (const child of Array.from(this.children)) {
      if (
        child &&
        'applyOptimization' in child &&
        typeof child.applyOptimization === 'function'
      ) {
        child.applyOptimization(optimizedProgram);
      }
    }
  }
}
