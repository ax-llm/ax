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
      return (
        `Invalid ${citations.field} entries: ${invalid.join(', ')}. ` +
        `Cite only evidence ids that exist: ${[...keys].join(', ')} — or leave the field empty.`
      );
    });
  }

  /**
   * Ids the responder may cite this call: the evidence object's top-level
   * keys plus (when configured) the `id` of record arrays one level deep —
   * the shape `recall(...)` memories arrive in. Returns `undefined` when the
   * payload carries no citable evidence.
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
        if (!Array.isArray(value)) {
          continue;
        }
        for (const item of value) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { id?: unknown }).id === 'string'
          ) {
            keys.add((item as { id: string }).id);
          }
        }
      }
    }
    return keys.size > 0 ? keys : undefined;
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
      let lastCitations: unknown;
      for await (const delta of this.program.streamingForward(
        ai,
        values,
        merged
      )) {
        const record = delta as { delta?: Record<string, unknown> };
        if (
          record?.delta &&
          typeof record.delta === 'object' &&
          citations.field in record.delta
        ) {
          lastCitations = record.delta[citations.field];
          if (citations.surface === 'hidden') {
            const { [citations.field]: _stripped, ...rest } = record.delta;
            yield { ...(delta as object), delta: rest } as any;
            continue;
          }
        }
        yield delta;
      }
      if (citations.onCitations) {
        Promise.resolve(
          citations.onCitations(this._normalizeCitations(lastCitations))
        ).catch(() => {});
      }
    } finally {
      this._validCitationKeys = undefined;
    }
  }
}
