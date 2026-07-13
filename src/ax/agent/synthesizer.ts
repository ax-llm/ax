import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import type { AxIField, AxSignature } from '../dsp/sig.js';
import type {
  AxChatLogEntry,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgramTrace,
  AxProgramUsage,
  AxTunable,
  AxUsable,
} from '../dsp/types.js';
import type { AxAgentExecutorResultPayload } from './agentInternal/agentInternalTypes.js';
import { buildResponderContextData } from './agentInternal/synthesizerContextData.js';
import type { AxResolvedCitations } from './config.js';
import { axBuildResponderDefinition } from './rlm.js';
import {
  requiredTemplateVariables,
  validatePromptTemplateSyntax,
} from './templateEngine.js';
import { promptTemplates, type TemplateId } from './templates.generated.js';

const TEMPLATE_ID_BY_ROLE = {
  final: 'rlm/responder.md',
} as const satisfies Record<string, TemplateId>;

export type AxSynthesizerRole = 'final';

export interface AxSynthesizerInit {
  /** Pre-built signature: `{ ...nonContextInputs, contextData } -> OUT`. */
  signature: AxSignature;
  /** Inline context-field metadata used by the responder template (titles/descriptions). */
  contextFieldMeta: readonly AxIField[];
  /** Stage role. Currently only the `responder` uses this class. */
  role: AxSynthesizerRole;
  /** Optional human-authored instruction prepended to the responder template. */
  description?: string;
  /** Optional agent identity rendered into the prompt. */
  agentIdentity?: { name: string; description: string; namespace?: string };
  /**
   * Resolved chain-of-evidence citations config. When enabled, the caller has
   * already appended the citations output field to the signature; this class
   * validates the model's citations against the per-call evidence ids and
   * surfaces/strips the field per `surface`.
   */
  citations?: AxResolvedCitations;
}

export interface AxSynthesizerOptions {
  /** Forward options merged onto every responder call (debug, model choice, etc.). */
  forwardOptions?: Partial<AxProgramForwardOptions<string>>;
  /** Stable id used in `namedPrograms()` (e.g. `responder`). */
  id?: string;
}

/**
 * The responder synthesis stage. Wraps an `AxGen` whose signature is
 * `{ ...nonContextInputs, contextData } -> outputFields`, rendered with
 * `rlm/responder.md`.
 *
 * Callers hand it the upstream actor's payload via `forward({ executorResult, ... })`;
 * the contextData reshape (`buildResponderContextData`) happens here, not at the
 * call site.
 */
export class Synthesizer<OUT extends AxGenOut = AxGenOut> {
  private readonly init: AxSynthesizerInit;
  private readonly options: AxSynthesizerOptions;
  private program!: AxGen<any, OUT>;
  private templateOverride: string | undefined;
  private _stopRequested = false;
  /**
   * Evidence ids valid for the in-flight call; `undefined` disables the
   * citations assert (no evidence this call). Per-call mutable state on a
   * shared stage — same accepted non-reentrancy class as the agent's
   * discovery/skills prompt state.
   */
  private _validCitationKeys: Set<string> | undefined;

  constructor(
    init: Readonly<AxSynthesizerInit>,
    options: Readonly<AxSynthesizerOptions> = {}
  ) {
    this.init = { ...init };
    this.options = { ...options };
    this._buildProgram();
    if (this.init.citations?.enabled) {
      this._registerCitationsAssert(this.init.citations);
    }
  }

  /**
   * Registered once — the underlying AxGen instance survives description
   * rebuilds and signature swaps, so the assert stays attached. Violations
   * return a dynamic message enumerating the invalid and valid ids, which
   * drives the standard validation-retry loop.
   */
  private _registerCitationsAssert(citations: AxResolvedCitations): void {
    this.program.addAssert((values: Record<string, unknown>) => {
      const keys = this._validCitationKeys;
      if (!keys) {
        return true;
      }
      const raw = values[citations.field];
      if (raw === undefined || raw === null) {
        return true;
      }
      const cited = (Array.isArray(raw) ? raw : [raw]).map(String);
      const invalid = cited.filter((id) => !keys.has(id));
      if (invalid.length === 0) {
        return true;
      }
      if (keys.size === 0) {
        return `This answer has no evidence to cite — leave ${citations.field} empty.`;
      }
      return (
        `Invalid ${citations.field} entries: ${invalid.join(', ')}. ` +
        `Cite only evidence ids that exist: ${[...keys].join(', ')} — or leave the field empty.`
      );
    });
  }

  /**
   * Ids the responder may cite this call: the evidence object's top-level
   * keys plus (when `includeMemoryIds`) the `id` of any records nested inside
   * it — arrays of records (the `recall()` memories shape), keyed maps of
   * records, or single records — with string OR numeric ids (DB keys are
   * commonly numeric). Returns `undefined` only when the payload carries no
   * evidence contract at all (absent / non-object / array); a plain object —
   * even empty `{}` — returns its (possibly empty) key set so the assert
   * rejects citations fabricated on an evidence-less run.
   */
  private _computeCitationKeys(
    executorResult: AxAgentExecutorResultPayload
  ): Set<string> | undefined {
    const evidence: unknown = executorResult?.args?.[1];
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return undefined;
    }
    const keys = new Set(Object.keys(evidence as Record<string, unknown>));
    if (this.init.citations?.includeMemoryIds) {
      for (const value of Object.values(evidence as Record<string, unknown>)) {
        this._collectNestedIds(value, keys, 2);
      }
    }
    return keys;
  }

  /**
   * Collect every `id` (string or number, stringified) reachable within
   * `depth` levels of `node`, descending through arrays and plain objects.
   * Bounded so a deeply nested / cyclic evidence object can't spin.
   */
  private _collectNestedIds(
    node: unknown,
    out: Set<string>,
    depth: number
  ): void {
    if (depth < 0 || !node || typeof node !== 'object') {
      return;
    }
    const id = (node as { id?: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') {
      out.add(String(id));
    }
    const children = Array.isArray(node)
      ? node
      : Object.values(node as Record<string, unknown>);
    for (const child of children) {
      if (child && typeof child === 'object') {
        this._collectNestedIds(child, out, depth - 1);
      }
    }
  }

  private _normalizeCitations(raw: unknown): string[] {
    if (raw === undefined || raw === null) {
      return [];
    }
    return (Array.isArray(raw) ? raw : [raw]).map(String);
  }

  /** Fire the observer and strip the field for `surface: 'hidden'`. */
  private _finalizeCitations(result: OUT, citations: AxResolvedCitations): OUT {
    const raw = (result as Record<string, unknown>)[citations.field];
    if (citations.onCitations) {
      Promise.resolve(
        citations.onCitations(this._normalizeCitations(raw))
      ).catch(() => {});
    }
    if (citations.surface === 'hidden' && citations.field in (result as any)) {
      const { [citations.field]: _stripped, ...rest } = result as Record<
        string,
        unknown
      >;
      return rest as OUT;
    }
    return result;
  }

  private _buildProgram(): void {
    const description = axBuildResponderDefinition(
      this.init.description,
      this.init.contextFieldMeta,
      {
        agentIdentity: this.init.agentIdentity,
        templateOverride: this.templateOverride,
      }
    );
    if (this.program) {
      this.program.setDescription(description);
    } else {
      this.program = new AxGen<any, OUT>(this.init.signature, {
        ...(this.options.forwardOptions ?? {}),
        description,
      });
      if (this.options.id) {
        this.program.setId(this.options.id);
      }
    }
  }

  private _templateId(): TemplateId {
    return TEMPLATE_ID_BY_ROLE[this.init.role];
  }

  public getRole(): AxSynthesizerRole {
    return this.init.role;
  }

  public getId(): string {
    return this.program.getId();
  }

  public setId(id: string): void {
    this.program.setId(id);
  }

  public getSignature(): AxSignature {
    return this.program.getSignature();
  }

  public getProgram(): AxGen<any, OUT> {
    return this.program;
  }

  public asTunableUsable(): Readonly<AxTunable<any, any> & AxUsable> {
    return this.program as unknown as Readonly<AxTunable<any, any> & AxUsable>;
  }

  public stop(): void {
    this._stopRequested = true;
    this.program.stop();
  }

  public resetUsage(): void {
    this.program.resetUsage();
  }

  public getUsage(): readonly AxProgramUsage[] {
    return this.program.getUsage();
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.program.getChatLog();
  }

  public getTraces(): readonly AxProgramTrace<any, OUT>[] {
    return this.program.getTraces();
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    return this.program.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<any, OUT>[] {
    return this.program.namedProgramInstances();
  }

  public setDemos(
    demos: readonly AxProgramDemos<any, OUT>[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    this.program.setDemos(demos, options);
  }

  public getOptimizableComponents(): readonly any[] {
    const out: any[] = [];
    out.push(...(this.program.getOptimizableComponents?.() ?? []));
    const id = this.getId();
    const tplId = this._templateId();
    const current = this.templateOverride ?? promptTemplates[tplId];
    out.push({
      key: `${id}::actor-tpl:${tplId}`,
      kind: 'actor-tpl',
      current,
      description: `RLM template '${tplId}' rendered as the synthesizer system prompt.`,
      constraints:
        'Preserve the full set of `{{var}}` placeholders the renderer expects; the result must be a valid template that parses cleanly.',
      validate: (value: string) =>
        validatePromptTemplateSyntax(
          value,
          `template-validate:${tplId}`,
          requiredTemplateVariables(tplId)
        ),
    });
    return out;
  }

  public applyOptimization(optimizedProgram: any): void {
    (this.program as any).applyOptimization?.(optimizedProgram);
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.program.applyOptimizedComponents?.(updates);
    const id = this.getId();
    const tplId = this._templateId();
    const tplKey = `${id}::actor-tpl:${tplId}`;
    const value = updates[tplKey];
    if (typeof value === 'string') {
      const valid =
        validatePromptTemplateSyntax(
          value,
          `template-validate:${tplId}`,
          requiredTemplateVariables(tplId)
        ) === true;
      if (valid) {
        this.templateOverride = value;
        this._buildProgram();
      }
    }
  }

  /**
   * Run the synthesizer non-streaming. Reshapes the upstream actor result into
   * `contextData` and merges it with `nonContextValues`.
   */
  public async forward(
    ai: AxAIService,
    args: Readonly<{
      nonContextValues: Record<string, unknown>;
      executorResult: AxAgentExecutorResultPayload;
      options?: Readonly<AxProgramForwardOptions<string>>;
    }>
  ): Promise<OUT> {
    if (this._stopRequested) {
      this._stopRequested = false;
      throw new Error('Synthesizer stopped by user (pre-forward)');
    }
    const { mem: _mem, ...callOptions } = args.options ?? {};
    const { mem: _configuredMem, ...configuredOptions } =
      this.options.forwardOptions ?? {};
    const merged: AxProgramForwardOptions<string> = {
      ...configuredOptions,
      ...callOptions,
      maxSteps: 1,
    };
    const citations = this.init.citations;
    if (citations?.enabled) {
      this._validCitationKeys = this._computeCitationKeys(args.executorResult);
    }
    try {
      const result = await this.program.forward(
        ai,
        {
          ...args.nonContextValues,
          contextData: buildResponderContextData(args.executorResult),
        },
        merged
      );
      return citations?.enabled
        ? this._finalizeCitations(result, citations)
        : result;
    } finally {
      this._validCitationKeys = undefined;
    }
  }

  /**
   * Streaming variant — only the responder uses this. Yields the
   * AxGen deltas; the pipeline appends `actorFieldValues` as a final delta
   * if any are present.
   */
  public async *streamingForward(
    ai: AxAIService,
    args: Readonly<{
      nonContextValues: Record<string, unknown>;
      executorResult: AxAgentExecutorResultPayload;
      options?: Readonly<AxProgramForwardOptions<string>>;
    }>
  ): AxGenStreamingOut<OUT> {
    if (this._stopRequested) {
      this._stopRequested = false;
      throw new Error('Synthesizer stopped by user (pre-forward)');
    }
    const { mem: _mem, ...callOptions } = args.options ?? {};
    const { mem: _configuredMem, ...configuredOptions } =
      this.options.forwardOptions ?? {};
    const merged: AxProgramForwardOptions<string> = {
      ...configuredOptions,
      ...callOptions,
      maxSteps: 1,
    };
    const values = {
      ...args.nonContextValues,
      contextData: buildResponderContextData(args.executorResult),
    };
    const citations = this.init.citations;
    if (!citations?.enabled) {
      yield* this.program.streamingForward(ai, values, merged);
      return;
    }
    this._validCitationKeys = this._computeCitationKeys(args.executorResult);
    try {
      // Array fields stream as disjoint slices (`newVal.slice(oldVal.length)`),
      // so accumulate across deltas rather than keeping only the last slice.
      // Reset on a version change — a validation retry re-streams under a new
      // version, and only the final version's citations should be reported.
      let citationAcc: string[] = [];
      let citationVersion: number | undefined;
      for await (const delta of this.program.streamingForward(
        ai,
        values,
        merged
      )) {
        const record = delta as {
          version?: number;
          delta?: Record<string, unknown>;
        };
        if (
          record?.delta &&
          typeof record.delta === 'object' &&
          citations.field in record.delta
        ) {
          if (record.version !== citationVersion) {
            citationAcc = [];
            citationVersion = record.version;
          }
          const chunk = record.delta[citations.field];
          for (const item of Array.isArray(chunk)
            ? chunk
            : chunk != null
              ? [chunk]
              : []) {
            citationAcc.push(String(item));
          }
          if (citations.surface === 'hidden') {
            const { [citations.field]: _stripped, ...rest } = record.delta;
            yield { ...(delta as object), delta: rest } as any;
            continue;
          }
        }
        yield delta;
      }
      if (citations.onCitations) {
        const finalCitations = citationAcc;
        Promise.resolve(citations.onCitations(finalCitations)).catch(() => {});
      }
    } finally {
      this._validCitationKeys = undefined;
    }
  }
}
