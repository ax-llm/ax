import type { AxOptimizableComponent } from './optimizable.js';
import type { AxOptimizedProgram } from './optimizer.js';
import { AxInstanceRegistry } from './registry.js';
import type { AxSignatureConfig } from './sig.js';
import { AxSignature } from './sig.js';
import type {
  AxChatLogEntry,
  AxFieldValue,
  AxNamedProgramInstance,
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
      if (cu) {
        const flat = Array.isArray(cu) ? cu : [...cu.actor, ...cu.responder];
        usage = [...usage, ...flat];
      }
    }
    return mergeProgramUsage(usage);
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    const chatLog: AxChatLogEntry[] = [];

    for (const child of Array.from(this.children)) {
      const entries = child?.getChatLog();
      if (!entries || entries.length === 0) {
        continue;
      }
      const childName = this.childNames.get(child);
      chatLog.push(
        ...entries.map((entry) => ({
          ...entry,
          ...(childName
            ? {
                name: entry.name ? `${childName}.${entry.name}` : childName,
              }
            : {}),
        }))
      );
    }

    return chatLog;
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

    // Filter demos for this program and validate each trace
    // biome-ignore lint/complexity/useFlatMap: it can't
    const filteredTraces = demos
      .filter((v) => v.programId === this.key.id)
      .map((v) => v.traces)
      .flat();

    const sig = this.signature;
    const fields = [...sig.getInputFields(), ...sig.getOutputFields()];
    const inputFieldNames = new Set(sig.getInputFields().map((f) => f.name));
    const outputFieldNames = new Set(sig.getOutputFields().map((f) => f.name));

    this.demos = filteredTraces.map((trace, i) => {
      const res: Record<string, AxFieldValue> = {};
      for (const f of fields) {
        const value = (trace as Record<string, AxFieldValue>)[f.name];
        if (value !== undefined) {
          validateValue(f, value);
          res[f.name] = value;
        }
      }

      // Require at least one input AND one output field value
      const hasInput = Object.keys(res).some((k) => inputFieldNames.has(k));
      const hasOutput = Object.keys(res).some((k) => outputFieldNames.has(k));

      if (!hasOutput) {
        throw new Error(
          `Demo trace[${i}] for '${this.key.id}' has no output field values. ` +
            `Expected at least one of: ${[...outputFieldNames].join(', ')}`
        );
      }
      if (!hasInput) {
        throw new Error(
          `Demo trace[${i}] for '${this.key.id}' has no input field values. ` +
            `Expected at least one of: ${[...inputFieldNames].join(', ')}. ` +
            `Provide input context so the demo renders as a complete few-shot example.`
        );
      }

      return res;
    }) as OUT[];

    if (options?.modelConfig) {
      (this as any)._optimizedModelConfig = options.modelConfig;
    }

    // Walk the tree: propagate demos + options to all children
    const wasPropagating = AxProgram._propagating;
    AxProgram._propagating = true;
    try {
      for (const child of Array.from(this.children)) {
        child?.setDemos(demos, options);
      }
    } finally {
      AxProgram._propagating = wasPropagating;
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

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    const result: AxNamedProgramInstance<IN, OUT>[] = [];

    const fields = [
      ...this.signature.getInputFields(),
      ...this.signature.getOutputFields(),
    ];
    if (fields.length > 0) {
      result.push({
        id: this.key.id,
        program: this,
        signature: this.signature.toString(),
      });
    }

    for (const child of Array.from(this.children)) {
      if (
        child &&
        'namedProgramInstances' in child &&
        typeof (child as any).namedProgramInstances === 'function'
      ) {
        result.push(...(child as any).namedProgramInstances());
      } else if (child) {
        result.push({
          id: child.getId(),
          program: child as AxTunable<IN, OUT>,
        });
      }
    }

    return result;
  }

  public applyOptimization(optimizedProgram: AxOptimizedProgram<OUT>): void {
    const hasDemos = optimizedProgram.demos !== undefined;
    const hasModelConfig = optimizedProgram.modelConfig !== undefined;
    if (hasDemos || hasModelConfig) {
      this.setDemos(optimizedProgram.demos ?? [], {
        modelConfig: optimizedProgram.modelConfig,
      });
    }

    if (
      optimizedProgram.componentMap &&
      Object.keys(optimizedProgram.componentMap).length > 0
    ) {
      this.applyOptimizedComponents(optimizedProgram.componentMap);
    }

    const instructionKey = `${this.key.id}::instruction`;
    if (
      typeof optimizedProgram.instruction === 'string' &&
      optimizedProgram.instruction.length > 0 &&
      optimizedProgram.componentMap?.[instructionKey] === undefined
    ) {
      this.applyOptimizedComponents({
        [instructionKey]: optimizedProgram.instruction,
      });
    }
  }

  /**
   * Walks the program tree and emits one `AxOptimizableComponent` per
   * string-valued artifact reachable from this node. Subclasses override
   * `localOptimizableComponents()` to add their own; tree traversal is
   * handled here so callers never need to recurse.
   */
  public getOptimizableComponents(): readonly AxOptimizableComponent[] {
    const out: AxOptimizableComponent[] = [];
    out.push(...this.localOptimizableComponents());
    for (const child of Array.from(this.children)) {
      const fn = (child as Partial<AxTunable<IN, OUT>>)
        .getOptimizableComponents;
      if (typeof fn === 'function') {
        out.push(...fn.call(child));
      }
    }
    return out;
  }

  /**
   * Components owned directly by this node (excluding children). Subclasses
   * override this to append their own kinds (e.g. AxGen adds `fn-desc:*`).
   */
  protected localOptimizableComponents(): readonly AxOptimizableComponent[] {
    const out: AxOptimizableComponent[] = [];
    const id = this.key.id;
    const anySelf = this as any;

    const description = this.signature.getDescription();
    if (typeof description === 'string') {
      out.push({
        key: `${id}::description`,
        kind: 'description',
        current: description,
        description:
          'Module role/task description. Appears in parent agents’ tool menus and as the top-level task definition for this module.',
      });
    }

    if (typeof anySelf.getInstruction === 'function') {
      const current = (anySelf.getInstruction() as string | undefined) ?? '';
      out.push({
        key: `${id}::instruction`,
        kind: 'instruction',
        current,
        description:
          'High-level instruction prepended to every prompt for this module. Use for strategy and rules; per-field guidance belongs in the signature.',
      });
    }

    return out;
  }

  /**
   * Broadcast component updates across this subtree. Each node filters keys
   * belonging to itself and dispatches via `applyLocalOptimizedComponents`.
   */
  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.applyLocalOptimizedComponents(updates);
    for (const child of Array.from(this.children)) {
      const fn = (child as Partial<AxTunable<IN, OUT>>)
        .applyOptimizedComponents;
      if (typeof fn === 'function') {
        fn.call(child, updates);
      }
    }
  }

  /**
   * Apply only this node's own components. Subclasses override to add their
   * own dispatch (e.g. AxGen handles `fn-desc:*` and `fn-name:*`).
   */
  protected applyLocalOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    const id = this.key.id;
    const anySelf = this as any;

    const descKey = `${id}::description`;
    if (typeof updates[descKey] === 'string') {
      this.setDescription(updates[descKey]!);
    }

    if (typeof anySelf.setInstruction === 'function') {
      const instrKey = `${id}::instruction`;
      if (typeof updates[instrKey] === 'string') {
        anySelf.setInstruction(updates[instrKey]!);
      }
    }
  }
}
