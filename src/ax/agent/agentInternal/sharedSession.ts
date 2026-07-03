import type { AxCodeRuntime, AxCodeSession } from '../rlm.js';
import {
  getPatchableSession,
  prepareRestoredState,
} from './runtimeSessionHelpers.js';
import type { AxAgentState } from './types.js';

/**
 * Worker global that carries the distiller's `final(request, evidence)`
 * evidence object across the phase boundary. It stays inside the runtime
 * session — the host only ever sees a compact descriptor — and is promoted to
 * `inputs.distilledContext` when the executor phase begins.
 */
export const AX_SHARED_EVIDENCE_GLOBAL = 'distilledContext';
const PHASE_GLOBAL = '__axSharedPhase';
/**
 * Staging global for per-key input merges. The pipeline patches
 * `{ [AX_INPUTS_PATCH_GLOBAL]: partial }` and then executes a merge snippet.
 * Simulated runtimes that don't evaluate JS should honor the contract in
 * their `patchGlobals`: apply the staged partial onto their `inputs` object.
 */
export const AX_INPUTS_PATCH_GLOBAL = '__axInputsPatch';
const INPUTS_PATCH_GLOBAL = AX_INPUTS_PATCH_GLOBAL;

/**
 * First line of every host-driven snippet the pipeline executes in a session
 * (final wrapper, phase boundary, input merge). Simulated/scripted runtimes
 * that count or pattern-match `execute` calls should treat code starting
 * with this marker as a no-op host snippet, not an actor turn.
 */
export const AX_HOST_SNIPPET_MARKER = '/* ax:host-snippet */';

/**
 * Shape summary of the distiller's evidence object. Built in-worker (shared
 * mode) or host-side (fallback mode) and rendered into the executor's
 * `distilledContextSummary` prompt field; the data itself never enters a
 * prompt.
 */
export type AxEvidenceDescriptor = {
  kind: 'axEvidenceDescriptor';
  totalChars: number;
  entries: {
    key: string;
    type: string;
    size: number;
    length?: number;
  }[];
};

export function isEvidenceDescriptor(
  value: unknown
): value is AxEvidenceDescriptor {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'axEvidenceDescriptor' &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

function describeEvidenceValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function safeStringifyLength(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.length : 0;
  } catch {
    return -1;
  }
}

/**
 * Serialized size of an evidence object for the `maxEvidenceChars` budget.
 * Returns -1 when the value cannot be serialized (budget check passes; the
 * structured-clone boundary reports its own error in that case).
 */
export function measureEvidenceChars(value: unknown): number {
  return safeStringifyLength(value);
}

/** Host-side descriptor builder (fallback mode, where evidence crosses). */
export function buildEvidenceDescriptor(
  evidence: Readonly<Record<string, unknown>>
): AxEvidenceDescriptor {
  const entries = Object.keys(evidence).map((key) => {
    const value = evidence[key];
    const size = safeStringifyLength(value);
    return {
      key,
      type: describeEvidenceValueType(value),
      size,
      ...(Array.isArray(value) ? { length: value.length } : {}),
    };
  });
  let totalChars = 0;
  for (const entry of entries) {
    if (entry.size > 0) totalChars += entry.size;
  }
  return { kind: 'axEvidenceDescriptor', totalChars, entries };
}

/**
 * Render a descriptor as the `distilledContextSummary` prompt text. Points the
 * executor at the runtime-resident value rather than materializing it.
 */
export function renderEvidenceDescriptor(
  descriptor: Readonly<AxEvidenceDescriptor>
): string {
  if (descriptor.entries.length === 0) {
    return `Evidence object is available in the runtime as \`inputs.${AX_SHARED_EVIDENCE_GLOBAL}\` (empty).`;
  }
  const lines = descriptor.entries.map((entry) => {
    const sizeText =
      entry.size >= 0 ? `~${entry.size} chars` : 'unserializable';
    const lengthText =
      typeof entry.length === 'number' ? `, ${entry.length} items` : '';
    return `- \`${entry.key}\` (${entry.type}${lengthText}, ${sizeText})`;
  });
  return [
    `Evidence keys available in the runtime as \`inputs.${AX_SHARED_EVIDENCE_GLOBAL}\` (~${descriptor.totalChars} chars total):`,
    ...lines,
  ].join('\n');
}

/**
 * In-worker bootstrap installed right after the distiller-phase session is
 * created. Wraps `final` so a two-arg call stashes the evidence object as a
 * worker global and forwards only a compact descriptor to the host. Invalid
 * shapes pass through untouched so the host binding's canonical validation
 * errors still fire in-turn.
 */
function buildDistillerFinalWrapperCode(): string {
  return `${AX_HOST_SNIPPET_MARKER}
(() => {
  const __axHostFinal = globalThis.final;
  if (typeof __axHostFinal !== 'function') { return; }
  const __axDescribe = (value) => {
    const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const sizeOf = (v) => {
      try { const s = JSON.stringify(v); return typeof s === 'string' ? s.length : 0; } catch { return -1; }
    };
    const entries = Object.keys(value).map((key) => {
      const v = value[key];
      const entry = { key, type: typeOf(v), size: sizeOf(v) };
      if (Array.isArray(v)) { entry.length = v.length; }
      return entry;
    });
    let totalChars = 0;
    for (const e of entries) { if (e.size > 0) totalChars += e.size; }
    return { kind: 'axEvidenceDescriptor', totalChars, entries };
  };
  globalThis.${PHASE_GLOBAL} = 'distiller';
  globalThis.final = (...args) => {
    const context = args[1];
    if (
      globalThis.${PHASE_GLOBAL} === 'distiller' &&
      args.length === 2 &&
      context !== null &&
      typeof context === 'object' &&
      !Array.isArray(context)
    ) {
      globalThis.${AX_SHARED_EVIDENCE_GLOBAL} = context;
      return __axHostFinal(args[0], __axDescribe(context));
    }
    return __axHostFinal(...args);
  };
})();`;
}

/**
 * Phase-boundary snippet: merge the executor's (small) input values into the
 * worker-resident \`inputs\` object per key, promote the stashed evidence to
 * \`inputs.${AX_SHARED_EVIDENCE_GLOBAL}\`, apply executor-side field
 * deletions, refresh top-level aliases, and flip the phase flag. Never
 * replaces \`inputs\` wholesale — context fields and distiller-created state
 * stay untouched.
 */
function buildExecutorPhaseBoundaryCode(
  deletions: readonly string[],
  aliasNames: readonly string[]
): string {
  return `${AX_HOST_SNIPPET_MARKER}
(() => {
  if (!globalThis.inputs || typeof globalThis.inputs !== 'object') { globalThis.inputs = {}; }
  const patch = globalThis.${INPUTS_PATCH_GLOBAL};
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch)) { globalThis.inputs[key] = patch[key]; }
  }
  globalThis.${INPUTS_PATCH_GLOBAL} = undefined;
  if (globalThis.${AX_SHARED_EVIDENCE_GLOBAL} !== undefined) {
    globalThis.inputs.${AX_SHARED_EVIDENCE_GLOBAL} = globalThis.${AX_SHARED_EVIDENCE_GLOBAL};
  }
  for (const key of ${JSON.stringify([...deletions])}) {
    try { delete globalThis.inputs[key]; } catch {}
    try { delete globalThis[key]; } catch {}
  }
  for (const key of ${JSON.stringify([...aliasNames])}) {
    globalThis[key] = globalThis.inputs[key];
  }
  globalThis.${PHASE_GLOBAL} = 'executor';
})();`;
}

/** Per-key input merge used for mid-phase syncs (never clobbers other keys). */
function buildInputsMergeCode(): string {
  return `${AX_HOST_SNIPPET_MARKER}
(() => {
  if (!globalThis.inputs || typeof globalThis.inputs !== 'object') { globalThis.inputs = {}; }
  const patch = globalThis.${INPUTS_PATCH_GLOBAL};
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch)) { globalThis.inputs[key] = patch[key]; }
  }
  globalThis.${INPUTS_PATCH_GLOBAL} = undefined;
})();`;
}

export type AxSharedSessionPhase = 'distiller' | 'executor';

/**
 * Coordinates one runtime session across the pipeline's distiller and
 * executor phases. Created per `AxAgent.forward()` by the pipeline, handed to
 * both actor runs, closed by the pipeline.
 *
 * Shared mode requires a JavaScript-capable runtime (the phase boundary is an
 * in-session snippet). For other runtimes the pipeline keeps `mode:
 * 'fallback'`: each stage runs in its own session exactly as before, and the
 * evidence value crosses through the host into the executor's runtime
 * globals — correctness preserved, zero-copy lost.
 */
export class AxAgentSharedRuntimeSession {
  public readonly mode: 'shared' | 'fallback';
  public phase: AxSharedSessionPhase = 'distiller';
  public session: AxCodeSession | undefined;
  /**
   * Cross-run state (from the coordinator's canonical executor-held
   * `AxAgentState`). Variable bindings are applied once when the phase-1
   * session is adopted; stage-level prompt state stays with each stage.
   */
  public restoreState: AxAgentState | undefined;
  /** Executor-stage field deletions applied at the phase boundary. */
  public excludeFieldDeletions: readonly string[] = [];
  /**
   * Phase-1 system/alias names, excluded from the executor phase's runtime
   * inspection so inherited context aliases don't render as user variables.
   */
  public phase1ReservedNames: readonly string[] = [];
  /** Fallback mode only: the real evidence value held host-side. */
  public fallbackEvidence: Record<string, unknown> | undefined;
  /**
   * Entries actually restored into the phase-1 session from `restoreState`,
   * kept for the distiller's restore notice / live-state rendering.
   */
  public restoredEntries: AxAgentState['runtimeEntries'] | undefined;
  private closed = false;

  constructor(options?: Readonly<{ mode?: 'shared' | 'fallback' }>) {
    this.mode = options?.mode ?? 'shared';
  }

  public get isShared(): boolean {
    return this.mode === 'shared';
  }

  /**
   * Adopt the freshly created phase-1 session: apply cross-run variable
   * bindings, install the in-worker `final` wrapper, remember reserved names.
   */
  public async adoptDistillerSession(
    session: AxCodeSession,
    options: Readonly<{
      reservedNames: readonly string[];
      signal?: AbortSignal;
    }>
  ): Promise<void> {
    if (!this.isShared) return;
    this.session = session;
    this.phase = 'distiller';
    this.phase1ReservedNames = [...options.reservedNames];

    if (this.restoreState) {
      const prepared = prepareRestoredState(
        this.restoreState,
        options.reservedNames
      );
      if (Object.keys(prepared.runtimeBindings).length > 0) {
        await getPatchableSession(session).patchGlobals(
          prepared.runtimeBindings,
          { signal: options.signal }
        );
        this.restoredEntries = prepared.runtimeEntries;
      }
    }

    await session.execute(buildDistillerFinalWrapperCode(), {
      signal: options.signal,
    });
  }

  /**
   * Transition the adopted session into the executor phase. `phaseGlobals`
   * are the executor run's host closures (final/askClarification/llmQuery/
   * tools/…) patched over the phase-1 bindings; `inputs` are the executor's
   * input values merged per key.
   */
  public async beginExecutorPhase(
    options: Readonly<{
      phaseGlobals: Record<string, unknown>;
      inputs: Record<string, unknown>;
      aliasNames: readonly string[];
      signal?: AbortSignal;
    }>
  ): Promise<void> {
    if (!this.isShared || !this.session) {
      throw new Error(
        'beginExecutorPhase() requires an adopted shared session'
      );
    }
    const session = getPatchableSession(this.session);
    await session.patchGlobals(options.phaseGlobals, {
      signal: options.signal,
    });
    await session.patchGlobals(
      { [INPUTS_PATCH_GLOBAL]: { ...options.inputs } },
      { signal: options.signal }
    );
    await this.session.execute(
      buildExecutorPhaseBoundaryCode(
        this.excludeFieldDeletions,
        options.aliasNames
      ),
      { signal: options.signal }
    );
    this.phase = 'executor';
  }

  /** Mid-phase per-key input sync (replaces wholesale `inputs` patches). */
  public async mergeInputs(
    inputs: Record<string, unknown>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<void> {
    if (!this.isShared || !this.session) return;
    const session = getPatchableSession(this.session);
    await session.patchGlobals(
      { [INPUTS_PATCH_GLOBAL]: { ...inputs } },
      { signal: options?.signal }
    );
    await this.session.execute(buildInputsMergeCode(), {
      signal: options?.signal,
    });
  }

  /**
   * Session-death recovery mid-phase: the runtime context recreated a fresh
   * session; track it so `close()` targets the live one. Inherited state is
   * gone, which matches the existing per-stage restart semantics.
   */
  public replaceSession(session: AxCodeSession): void {
    this.session = session;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.session?.close();
    } catch {
      // Ignore close errors — mirrors the actor loop's close handling.
    }
    this.session = undefined;
  }
}

/**
 * Every JavaScript runtime runs shared mode — a session IS a REPL, and the
 * protocol (function-valued `patchGlobals`, host-driven boundary snippets)
 * is table stakes for anything that can run the actor loop at all. The only
 * fallback is for non-JavaScript-language runtimes, whose sessions cannot
 * execute the JS boundary snippets; they keep per-stage sessions with the
 * evidence value carried through the host (identical prompt contract).
 */
export function supportsSharedRuntimeSession(
  runtime: Readonly<AxCodeRuntime> | undefined,
  isJavaScriptRuntime: boolean
): boolean {
  return Boolean(runtime) && isJavaScriptRuntime;
}
