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
import type { AxAgentActorResultPayload } from './agentInternal/agentInternalTypes.js';
import { buildResponderContextData } from './agentInternal/synthesizerContextData.js';
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
  /** Stage role. Currently only the `finalResponder` uses this class. */
  role: AxSynthesizerRole;
  /** Optional human-authored instruction prepended to the responder template. */
  description?: string;
  /** Optional agent identity rendered into the prompt. */
  agentIdentity?: { name: string; description: string; namespace?: string };
}

export interface AxSynthesizerOptions {
  /** Forward options merged onto every responder call (debug, model choice, etc.). */
  forwardOptions?: Partial<AxProgramForwardOptions<string>>;
  /** Stable id used in `namedPrograms()` (e.g. `finalResponder`). */
  id?: string;
}

/**
 * The finalResponder synthesis stage. Wraps an `AxGen` whose signature is
 * `{ ...nonContextInputs, contextData } -> outputFields`, rendered with
 * `rlm/responder.md`.
 *
 * Callers hand it the upstream actor's payload via `forward({ actorResult, ... })`;
 * the contextData reshape (`buildResponderContextData`) happens here, not at the
 * call site.
 */
export class Synthesizer<OUT extends AxGenOut = AxGenOut> {
  private readonly init: AxSynthesizerInit;
  private readonly options: AxSynthesizerOptions;
  private program!: AxGen<any, OUT>;
  private templateOverride: string | undefined;
  private _stopRequested = false;

  constructor(
    init: Readonly<AxSynthesizerInit>,
    options: Readonly<AxSynthesizerOptions> = {}
  ) {
    this.init = { ...init };
    this.options = { ...options };
    this._buildProgram();
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
      actorResult: AxAgentActorResultPayload;
      options?: Readonly<AxProgramForwardOptions<string>>;
    }>
  ): Promise<OUT> {
    if (this._stopRequested) {
      this._stopRequested = false;
      throw new Error('Synthesizer stopped by user (pre-forward)');
    }
    const merged: AxProgramForwardOptions<string> = {
      ...(this.options.forwardOptions ?? {}),
      ...(args.options ?? {}),
      maxSteps: 1,
    };
    return this.program.forward(
      ai,
      {
        ...args.nonContextValues,
        contextData: buildResponderContextData(args.actorResult),
      },
      merged
    );
  }

  /**
   * Streaming variant — only the finalResponder uses this. Yields the
   * AxGen deltas; the pipeline appends `actorFieldValues` as a final delta
   * if any are present.
   */
  public async *streamingForward(
    ai: AxAIService,
    args: Readonly<{
      nonContextValues: Record<string, unknown>;
      actorResult: AxAgentActorResultPayload;
      options?: Readonly<AxProgramForwardOptions<string>>;
    }>
  ): AxGenStreamingOut<OUT> {
    if (this._stopRequested) {
      this._stopRequested = false;
      throw new Error('Synthesizer stopped by user (pre-forward)');
    }
    const merged: AxProgramForwardOptions<string> = {
      ...(this.options.forwardOptions ?? {}),
      ...(args.options ?? {}),
      maxSteps: 1,
    };
    yield* this.program.streamingForward(
      ai,
      {
        ...args.nonContextValues,
        contextData: buildResponderContextData(args.actorResult),
      },
      merged
    );
  }
}
