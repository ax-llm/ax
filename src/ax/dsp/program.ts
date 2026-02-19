import type { AxOptimizedProgram } from './optimizer.js';
import { AxInstanceRegistry } from './registry.js';
import type { AxSignatureConfig } from './sig.js';
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

export class AxProgram<IN = any, OUT = any>
  implements AxUsable, AxTunable<IN, OUT>
{
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
  private childNames: Map<Readonly<AxTunable<IN, OUT> & AxUsable>, string> =
    new Map();
  private childCount = 0;

  constructor(
    signature:
      | string
      | Readonly<AxSignatureConfig>
      | Readonly<AxSignature>
      | undefined,
    options?: Readonly<AxProgramOptions>
  ) {
    this.signature = new AxSignature(signature);

    if (options?.description) {
      this.signature.setDescription(options.description);
    }

    if (options?.traceLabel) {
      this.traceLabel = options.traceLabel;
    }

    // Only validate if signature is provided
    if (signature) {
      this.signature.validate();
    }

    this.sigHash = this.signature?.hash();
    this.children = new AxInstanceRegistry();
    this.key = { id: 'root' };
  }

  public getSignature(): AxSignature {
    return new AxSignature(this.signature);
  }

  public setSignature(
    signature: string | Readonly<AxSignatureConfig> | Readonly<AxSignature>
  ): void {
    this.signature = new AxSignature(signature);

    // Validate the new signature if it's provided
    if (signature) {
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
  }

  public getId(): string {
    return this.key.id;
  }

  public register(
    prog: Readonly<AxTunable<IN, OUT> & AxUsable>,
    name?: string
  ) {
    const childName = name ?? `p${this.childCount}`;
    this.childCount++;
    prog.setId([this.key.id, childName].join('.'));
    this.childNames.set(prog, childName);
    this.children.register(prog);
  }

  public setId(id: string) {
    this.key = { id, custom: true };
    for (const [child, localName] of this.childNames) {
      child.setId([id, localName].join('.'));
    }
  }

  public setExamples(
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

  private static _propagating = false;

  public setDemos(
    demos: readonly AxProgramDemos<IN, OUT>[],
    options?: { modelConfig?: Record<string, unknown> }
  ) {
    // Validate programIds at the top-level call only
    if (!AxProgram._propagating && demos.length > 0) {
      const knownIds = new Set(this.namedPrograms().map((p) => p.id));
      const unknownIds = [...new Set(demos.map((d) => d.programId))].filter(
        (id) => !knownIds.has(id)
      );
      if (unknownIds.length > 0) {
        const validIds = [...knownIds].join(', ');
        throw new Error(
          `Unknown program ID(s) in demos: ${unknownIds.join(', ')}. ` +
            `Valid IDs: ${validIds}. ` +
            `Use namedPrograms() to discover available IDs.`
        );
      }
    }

    // biome-ignore lint/complexity/useFlatMap: it can't
    this.demos = demos
      .filter((v) => v.programId === this.key.id)
      .map((v) => v.traces)
      .flat();

    if (options?.modelConfig) {
      (this as any)._optimizedModelConfig = options.modelConfig;
    }

    // Walk the tree: propagate demos + options to all children
    AxProgram._propagating = true;
    try {
      for (const child of Array.from(this.children)) {
        child?.setDemos(demos, options);
      }
    } finally {
      AxProgram._propagating = false;
    }
  }

  /**
   * Returns all programs in the hierarchy with their IDs and signatures.
   * Use this to discover the IDs needed for `setDemos()`.
   *
   * Equivalent to DSPy's `named_parameters()`.
   *
   * @example
   * ```ts
   * agent.setId('qa');
   * console.log(agent.namedPrograms());
   * // [
   * //   { id: 'qa.actor', signature: '... -> javascriptCode' },
   * //   { id: 'qa.responder', signature: '... -> answer' },
   * // ]
   * ```
   */
  public namedPrograms(): Array<{ id: string; signature?: string }> {
    const result: Array<{ id: string; signature?: string }> = [];

    // Include self if it has a real signature (input/output fields)
    const fields = [
      ...this.signature.getInputFields(),
      ...this.signature.getOutputFields(),
    ];
    if (fields.length > 0) {
      result.push({
        id: this.key.id,
        signature: this.signature.toString(),
      });
    }

    // Recursively collect from children
    for (const child of Array.from(this.children)) {
      if (
        child &&
        'namedPrograms' in child &&
        typeof (child as any).namedPrograms === 'function'
      ) {
        result.push(...(child as any).namedPrograms());
      } else if (child) {
        result.push({ id: child.getId() });
      }
    }

    return result;
  }

  public applyOptimization(optimizedProgram: AxOptimizedProgram<OUT>): void {
    this.setDemos(optimizedProgram.demos ?? [], {
      modelConfig: optimizedProgram.modelConfig,
    });
  }
}
