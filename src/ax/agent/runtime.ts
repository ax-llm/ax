import type { AxIField } from '../dsp/sig.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import {
  type AxAIServiceAbortedError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import { stripJsStringsAndComments } from '../util/jsAnalysis.js';
import type {
  AxContextFieldInput,
  AxContextFieldPromptConfig,
} from './AxAgent.js';
import { AxAgentClarificationError } from './AxAgent.js';
import type {
  RuntimeStateSnapshotEntry,
  RuntimeStateVariableProvenance,
} from './contextManager.js';
import { smartStringify } from './truncate.js';

const SAFE_BOOTSTRAP_GLOBAL_IDENTIFIER = /^[$A-Z_a-z][$0-9A-Z_a-z]*$/;
const UNSAFE_BOOTSTRAP_GLOBAL_NAMES = new Set([
  'context',
  '__proto__',
  'prototype',
  'constructor',
  'globalThis',
  'global',
  'self',
  'window',
  'console',
  'JSON',
  'Math',
  'Reflect',
  'Atomics',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'Symbol',
  'Date',
  'RegExp',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Proxy',
  'Function',
  'Intl',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'AbortSignal',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'eval',
  'undefined',
  'Infinity',
  'NaN',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);
export const DISCOVERY_DISCOVER_NAME = 'discover';
export const MEMORIES_LOAD_NAME = 'recall';
export const TEST_HARNESS_LLM_QUERY_AI_REQUIRED_ERROR =
  'AI service is required to use llmQuery(...) in AxAgent.test(). Pass options.ai or configure ai on the agent.';
export const RUNTIME_RESTART_NOTICE =
  '[The JavaScript runtime was restarted; all global state was lost and must be recreated if needed.]';

export function buildInternalSummaryRequestOptions(
  options: Readonly<AxProgramForwardOptions<string>> | undefined,
  debug: boolean,
  abortSignal: AbortSignal | undefined
): Omit<AxProgramForwardOptions<string>, 'functions'> {
  return {
    model: options?.model,
    modelConfig: options?.modelConfig,
    debug,
    verbose: options?.verbose,
    rateLimiter: options?.rateLimiter,
    fetch: options?.fetch,
    tracer: options?.tracer,
    meter: options?.meter,
    timeout: options?.timeout,
    excludeContentFromTrace: options?.excludeContentFromTrace,
    abortSignal,
    logger: options?.logger,
    sessionId: options?.sessionId,
    debugHideSystemPrompt: options?.debugHideSystemPrompt,
    traceContext: options?.traceContext,
    thinkingTokenBudget: options?.thinkingTokenBudget,
    showThoughts: options?.showThoughts,
    useExpensiveModel: options?.useExpensiveModel,
    corsProxy: options?.corsProxy,
    retry: options?.retry,
    contextCache: options?.contextCache,
    customLabels: options?.customLabels,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSafeBootstrapGlobalName(
  name: string,
  reservedNames: ReadonlySet<string>
): boolean {
  return (
    !reservedNames.has(name) &&
    !UNSAFE_BOOTSTRAP_GLOBAL_NAMES.has(name) &&
    SAFE_BOOTSTRAP_GLOBAL_IDENTIFIER.test(name)
  );
}

export function buildBootstrapRuntimeGlobals(
  context: unknown,
  reservedNames: ReadonlySet<string>
): Record<string, unknown> {
  if (context === undefined) {
    return {};
  }

  const globals: Record<string, unknown> = {
    context,
  };

  if (!isPlainObject(context)) {
    return globals;
  }

  for (const [key, value] of Object.entries(context)) {
    if (!isSafeBootstrapGlobalName(key, reservedNames)) {
      continue;
    }
    globals[key] = value;
  }

  return globals;
}

function describeBootstrapRuntimeValue(value: unknown): {
  type: string;
  ctor?: string;
} {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { type: 'array', ctor: 'Array' };
  }
  if (value instanceof Map) {
    return { type: 'map', ctor: 'Map' };
  }
  if (value instanceof Set) {
    return { type: 'set', ctor: 'Set' };
  }
  if (value instanceof Date) {
    return { type: 'date', ctor: 'Date' };
  }
  if (value instanceof Error) {
    return {
      type: 'error',
      ctor:
        typeof value.name === 'string' && value.name.trim()
          ? value.name
          : 'Error',
    };
  }

  const type = typeof value;
  if (type !== 'object') {
    return { type };
  }

  const ctor =
    value &&
    (value as { constructor?: { name?: unknown } }).constructor &&
    typeof (value as { constructor?: { name?: unknown } }).constructor?.name ===
      'string'
      ? (value as { constructor?: { name: string } }).constructor?.name
      : undefined;

  return { type: 'object', ctor };
}

function previewBootstrapRuntimeAtom(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }

  const valueType = typeof value;
  if (valueType === 'string') {
    return JSON.stringify(truncateToCharBudget(value as string, 40));
  }
  if (
    valueType === 'number' ||
    valueType === 'boolean' ||
    valueType === 'bigint'
  ) {
    return String(value);
  }
  if (valueType === 'symbol') {
    return String(value);
  }
  if (valueType === 'function') {
    return `[function ${(value as { name?: string }).name || 'anonymous'}]`;
  }
  if (Array.isArray(value)) {
    return `[array(${value.length})]`;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? value.toISOString()
      : String(value);
  }
  if (value instanceof Error) {
    return `${value.name || 'Error'}: ${value.message || ''}`;
  }
  if (value instanceof Map) {
    return `[map(${value.size})]`;
  }
  if (value instanceof Set) {
    return `[set(${value.size})]`;
  }

  const ctorName =
    value &&
    (value as { constructor?: { name?: unknown } }).constructor &&
    typeof (value as { constructor?: { name?: unknown } }).constructor?.name ===
      'string'
      ? (value as { constructor?: { name: string } }).constructor?.name
      : '';
  return ctorName && ctorName !== 'Object' ? `[${ctorName}]` : '[object]';
}

function previewBootstrapRuntimeValue(
  value: unknown,
  type: string,
  ctor?: string
): string {
  if (type === 'array' && Array.isArray(value)) {
    const items = value
      .slice(0, 3)
      .map((item) => previewBootstrapRuntimeAtom(item));
    return `[${items.join(', ')}${value.length > 3 ? ', ...' : ''}]`;
  }
  if (type === 'map' && value instanceof Map) {
    const items = [...value.entries()]
      .slice(0, 3)
      .map(
        ([key, item]) =>
          `${previewBootstrapRuntimeAtom(key)} => ${previewBootstrapRuntimeAtom(item)}`
      );
    return `Map(${value.size}) {${items.join(', ')}${value.size > 3 ? ', ...' : ''}}`;
  }
  if (type === 'set' && value instanceof Set) {
    const items = [...value.values()]
      .slice(0, 5)
      .map((item) => previewBootstrapRuntimeAtom(item));
    return `Set(${value.size}) {${items.join(', ')}${value.size > 5 ? ', ...' : ''}}`;
  }
  if (type === 'object' && value && typeof value === 'object') {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 4);
    const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
    return `${prefix}{${shown.join(', ')}${keys.length > shown.length ? ', ...' : ''}}`;
  }

  return previewBootstrapRuntimeAtom(value);
}

function describeBootstrapRuntimeSize(
  value: unknown,
  type: string
): string | undefined {
  if (type === 'string' && typeof value === 'string') {
    return `${value.length} chars`;
  }
  if (type === 'array' && Array.isArray(value)) {
    return `${value.length} items`;
  }
  if ((type === 'map' || type === 'set') && value instanceof Map) {
    return `${value.size} items`;
  }
  if ((type === 'map' || type === 'set') && value instanceof Set) {
    return `${value.size} items`;
  }
  if (type === 'object' && value && typeof value === 'object') {
    return `${Object.keys(value).length} keys`;
  }
  return undefined;
}

function describeArrayElementKeys(value: unknown[]): string | undefined {
  if (value.length === 0) {
    return undefined;
  }
  const first = value[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const keys = Object.keys(first).slice(0, 8);
    if (keys.length > 0) {
      return keys.join(', ');
    }
  }
  return undefined;
}

function createBootstrapRuntimeSnapshotEntries(
  bindings: Readonly<Record<string, unknown>>
): RuntimeStateSnapshotEntry[] {
  return Object.entries(bindings).map(([name, value]) => {
    try {
      const meta = describeBootstrapRuntimeValue(value);
      const size = describeBootstrapRuntimeSize(value, meta.type);
      const preview = previewBootstrapRuntimeValue(value, meta.type, meta.ctor);

      // For arrays of objects, show element schema keys as a compact structural hint
      let elementKeysHint: string | undefined;
      if (meta.type === 'array' && Array.isArray(value)) {
        elementKeysHint = describeArrayElementKeys(value);
      }

      const compactPreview = preview
        ? truncateToCharBudget(preview, 40)
        : undefined;
      const fullPreview = elementKeysHint
        ? compactPreview
          ? `${compactPreview} — element keys: ${elementKeysHint}`
          : `element keys: ${elementKeysHint}`
        : compactPreview;

      return {
        name,
        type: meta.type,
        ...(meta.ctor ? { ctor: meta.ctor } : {}),
        ...(size ? { size } : {}),
        ...(fullPreview ? { preview: fullPreview } : {}),
      };
    } catch {
      return {
        name,
        type: 'unknown',
        preview: '[unavailable]',
      };
    }
  });
}

export function formatBootstrapContextSummary(
  bindings: Readonly<Record<string, unknown>>,
  options?: Readonly<{
    maxEntries?: number;
    maxChars?: number;
    budgetRemaining?: number;
    budgetTotal?: number;
  }>
): string {
  const entries = createBootstrapRuntimeSnapshotEntries(bindings);
  const state = formatStructuredRuntimeState(entries, new Map(), options);
  const budgetLine =
    options?.budgetRemaining !== undefined && options?.budgetTotal !== undefined
      ? `\nSub-query budget: ${options.budgetRemaining}/${options.budgetTotal} remaining`
      : '';
  return `Explore with code — do not assume values from these previews.\n${state}${budgetLine}`;
}

export function formatBubbledActorTurnOutput(
  error: AxAgentClarificationError | AxAIServiceAbortedError | Error,
  maxRuntimeChars: number
): string {
  if (error instanceof AxAgentClarificationError) {
    return truncateText(`[CLARIFICATION] ${error.question}`, maxRuntimeChars);
  }

  return formatInterpreterError(error, maxRuntimeChars);
}

export function isTransientError(error: unknown): boolean {
  if (
    error instanceof AxAIServiceStatusError &&
    error.status >= 500 &&
    error.status < 600
  ) {
    return true;
  }
  return (
    error instanceof AxAIServiceNetworkError ||
    error instanceof AxAIServiceTimeoutError
  );
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function truncateToCharBudget(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function isRuntimeStateSnapshotEntry(
  value: unknown
): value is RuntimeStateSnapshotEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    (candidate.ctor === undefined || typeof candidate.ctor === 'string') &&
    (candidate.size === undefined || typeof candidate.size === 'string') &&
    (candidate.preview === undefined ||
      typeof candidate.preview === 'string') &&
    (candidate.restorable === undefined ||
      typeof candidate.restorable === 'boolean')
  );
}

export function parseRuntimeStateSnapshot(
  snapshot: string
): RuntimeStateSnapshotEntry[] | undefined {
  const trimmed = snapshot.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as
      | { entries?: unknown[] }
      | unknown[]
      | null;
    const rawEntries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)
        ? parsed.entries
        : undefined;

    if (!rawEntries) {
      return undefined;
    }

    return rawEntries.filter(isRuntimeStateSnapshotEntry);
  } catch {
    return undefined;
  }
}

function formatRuntimeStateLines(
  lines: readonly string[],
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const maxEntries =
    options?.maxEntries && options.maxEntries > 0
      ? options.maxEntries
      : undefined;
  const maxChars =
    options?.maxChars && options.maxChars > 0 ? options.maxChars : undefined;
  const boundedLines = maxEntries ? lines.slice(0, maxEntries) : [...lines];

  if (!maxChars) {
    return boundedLines.join('\n');
  }

  const result: string[] = [];
  let usedChars = 0;
  for (const line of boundedLines) {
    const separatorChars = result.length > 0 ? 1 : 0;
    const remainingChars = maxChars - usedChars - separatorChars;
    if (remainingChars <= 0) {
      break;
    }
    if (line.length <= remainingChars) {
      result.push(line);
      usedChars += separatorChars + line.length;
      continue;
    }
    result.push(truncateToCharBudget(line, remainingChars));
    usedChars = maxChars;
    break;
  }

  return result.join('\n');
}

export function formatLegacyRuntimeState(
  snapshot: string,
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const lines = snapshot
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return formatRuntimeStateLines(lines, options);
}

function getRuntimeStateSalience(
  entry: Readonly<RuntimeStateSnapshotEntry>,
  provenance: Readonly<RuntimeStateVariableProvenance> | undefined
): number {
  let score = 0;

  if (provenance) {
    score += 1_000_000;
    score += provenance.createdTurn * 100;
    score += (provenance.lastReadTurn ?? provenance.createdTurn) * 10_000;
    if (provenance.source) {
      score += 25;
    }
  }

  if (entry.type === 'accessor') {
    score -= 100;
  } else if (entry.type === 'function') {
    score -= 10;
  }

  return score;
}

function formatRuntimeStateType(
  entry: Readonly<RuntimeStateSnapshotEntry>
): string {
  let label = entry.type;

  if (entry.type === 'object' && entry.ctor && entry.ctor !== 'Object') {
    label = `object<${entry.ctor}>`;
  } else if (entry.type === 'error' && entry.ctor && entry.ctor !== 'Error') {
    label = `error<${entry.ctor}>`;
  }

  if (entry.size) {
    label += ` (${entry.size})`;
  }

  return label;
}

function formatRuntimeStateProvenance(
  provenance: Readonly<RuntimeStateVariableProvenance> | undefined
): string {
  if (!provenance) {
    return '';
  }

  const details = [
    `from t${provenance.createdTurn}${provenance.source ? ` via ${provenance.source}` : ''}`,
  ];
  if (
    provenance.lastReadTurn !== undefined &&
    provenance.lastReadTurn > provenance.createdTurn
  ) {
    details.push(`read t${provenance.lastReadTurn}`);
  }

  return ` [${details.join('; ')}]`;
}

export function formatStructuredRuntimeState(
  entries: readonly RuntimeStateSnapshotEntry[],
  provenance: ReadonlyMap<string, RuntimeStateVariableProvenance>,
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const lines = [...entries]
    .sort((left, right) => {
      const leftScore = getRuntimeStateSalience(
        left,
        provenance.get(left.name)
      );
      const rightScore = getRuntimeStateSalience(
        right,
        provenance.get(right.name)
      );
      return rightScore - leftScore || left.name.localeCompare(right.name);
    })
    .map((entry) => {
      const preview = entry.preview ? ` = ${entry.preview}` : '';
      const provenanceSuffix = formatRuntimeStateProvenance(
        provenance.get(entry.name)
      );
      const restoreSuffix =
        'restorable' in entry && entry.restorable === false
          ? ' [snapshot only]'
          : '';

      return `${entry.name}: ${formatRuntimeStateType(entry)}${preview}${provenanceSuffix}${restoreSuffix}`;
    });

  if (lines.length === 0) {
    return '(no user variables)';
  }

  return formatRuntimeStateLines(lines, options);
}

export function formatInterpreterOutput(
  result: unknown,
  maxRuntimeChars: number
): string {
  if (result === undefined) {
    return '(no output)';
  }
  if (typeof result === 'string') {
    return truncateText(result || '(no output)', maxRuntimeChars);
  }
  try {
    return truncateText(
      smartStringify(result, maxRuntimeChars),
      maxRuntimeChars
    );
  } catch {
    return truncateText(String(result), maxRuntimeChars);
  }
}

export function formatInterpreterError(
  err: unknown,
  maxRuntimeChars: number
): string {
  const typedErr = err as {
    name?: string;
    message?: string;
    stack?: string;
    cause?: unknown;
    data?: unknown;
  };
  const name = typedErr?.name ?? 'Error';
  const message = typedErr?.message ?? String(err);
  const parts: string[] = [`${name}: ${message}`];

  if (typedErr?.data !== undefined) {
    try {
      parts.push(`Data: ${JSON.stringify(typedErr.data, null, 2)}`);
    } catch {
      parts.push(`Data: ${String(typedErr.data)}`);
    }
  }

  if (typedErr?.cause !== undefined) {
    const fmtCause = (cause: unknown, depth: number): string => {
      if (depth > 4) {
        return '[cause chain truncated]';
      }
      const c = cause as typeof typedErr;
      const cName = c?.name ?? 'Error';
      const cMsg = c?.message ?? String(cause);
      const cParts: string[] = [`${cName}: ${cMsg}`];
      if (c?.data !== undefined) {
        try {
          cParts.push(`Data: ${JSON.stringify(c.data, null, 2)}`);
        } catch {
          cParts.push(`Data: ${String(c.data)}`);
        }
      }
      if (c?.cause !== undefined) {
        cParts.push(`Caused by: ${fmtCause(c.cause, depth + 1)}`);
      }
      return cParts.join('\n');
    };
    parts.push(`Caused by: ${fmtCause(typedErr.cause, 1)}`);
  }

  return truncateText(parts.join('\n'), maxRuntimeChars);
}

const COMPLETION_SIGNAL_CALL_PATTERN = /\b(?:final|askClarification)\s*\(/;

export function hasCompletionSignalCall(code: string): boolean {
  const sanitized = stripJsStringsAndComments(code);
  return COMPLETION_SIGNAL_CALL_PATTERN.test(sanitized);
}

export function looksLikePromisePlaceholder(result: unknown): boolean {
  if (
    result &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    return true;
  }
  return typeof result === 'string' && result.trim() === '[object Promise]';
}

export function isSessionClosedError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Session is closed';
}

export function isExecutionTimedOutError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Execution timed out';
}

export function isLikelyRuntimeErrorOutput(output: string): boolean {
  if (output.startsWith('[ERROR]')) {
    return true;
  }
  if (output.startsWith(RUNTIME_RESTART_NOTICE)) {
    return true;
  }
  return /^(AggregateError|Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError): /.test(
    output
  );
}

export function buildContextFieldPromptInlineValue(
  value: unknown,
  promptConfig: AxContextFieldPromptConfig
): unknown {
  if (promptConfig.kind === 'threshold') {
    return estimateValueSize(value) <= promptConfig.promptMaxChars
      ? value
      : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const keepChars = promptConfig.keepInPromptChars;
  if (value.length <= keepChars) {
    return value;
  }

  const truncatedChars = value.length - keepChars;
  if (promptConfig.reverseTruncate) {
    const suffix = keepChars > 0 ? value.slice(-keepChars) : '';
    return `[truncated ${truncatedChars} chars]...${suffix}`;
  }

  const prefix = keepChars > 0 ? value.slice(0, keepChars) : '';
  return `${prefix}...[truncated ${truncatedChars} chars]`;
}

function describeContextFieldPromptMode(
  value: unknown,
  promptConfig: AxContextFieldPromptConfig,
  isInlined: boolean
): string {
  if (promptConfig.kind === 'threshold') {
    return isInlined
      ? `inline (<=${promptConfig.promptMaxChars} chars)`
      : `runtime-only (>${promptConfig.promptMaxChars} chars)`;
  }

  if (typeof value !== 'string') {
    // Auto-promoted non-string values can be inlined as a stringified
    // preview; declared truncate-config fields never inline non-strings.
    return isInlined
      ? `inline-truncated stringified(first ${promptConfig.keepInPromptChars} chars)`
      : 'runtime-only (keepInPromptChars requires string)';
  }

  if (!isInlined) {
    return 'runtime-only';
  }

  if (value.length <= promptConfig.keepInPromptChars) {
    return `inline (<=${promptConfig.keepInPromptChars} chars)`;
  }

  return promptConfig.reverseTruncate
    ? `inline-truncated(last ${promptConfig.keepInPromptChars} chars of ${value.length})`
    : `inline-truncated(first ${promptConfig.keepInPromptChars} chars of ${value.length})`;
}

export function estimateValueSize(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

/**
 * True when a truncated string preview is a valid value for this input field
 * (per `validateValue`): untyped fields and scalar string-typed kinds accept
 * plain strings; arrays, numbers, booleans, objects, and media types do not.
 */
export function fieldAcceptsStringPreview(
  field: Readonly<Pick<AxIField, 'type'>> | undefined
): boolean {
  if (!field) {
    return false;
  }
  const type = field.type;
  if (!type) {
    return true;
  }
  if (type.isArray) {
    return false;
  }
  return (
    type.name === 'string' ||
    type.name === 'code' ||
    type.name === 'class' ||
    type.name === 'json' ||
    type.name === 'date' ||
    type.name === 'datetime'
  );
}

export function normalizeContextFields(
  contextFields: readonly AxContextFieldInput[],
  inputFields: readonly AxIField[],
  defaultPromptMaxChars: number
): {
  contextFieldNames: string[];
  promptConfigByField: Map<string, AxContextFieldPromptConfig>;
} {
  const inputFieldNames = new Set(inputFields.map((f) => f.name));
  const seen = new Set<string>();
  const contextFieldNames: string[] = [];
  const promptConfigByField = new Map<string, AxContextFieldPromptConfig>();

  for (const cf of contextFields) {
    const field = typeof cf === 'string' ? cf : cf.field;

    if (!inputFieldNames.has(field)) {
      throw new Error(`RLM contextField "${field}" not found in signature`);
    }
    if (seen.has(field)) {
      throw new Error(`Duplicate contextField "${field}"`);
    }
    seen.add(field);
    contextFieldNames.push(field);

    if (typeof cf !== 'string') {
      const hasKeepInPromptChars = cf.keepInPromptChars !== undefined;
      const hasPromptMaxChars = cf.promptMaxChars !== undefined;

      if (hasKeepInPromptChars && hasPromptMaxChars) {
        throw new Error(
          `contextField "${field}" cannot set both promptMaxChars and keepInPromptChars`
        );
      }

      if ('reverseTruncate' in cf && !hasKeepInPromptChars) {
        throw new Error(
          `contextField "${field}" reverseTruncate requires keepInPromptChars`
        );
      }

      if (hasKeepInPromptChars) {
        const keepInPromptChars = cf.keepInPromptChars;
        if (
          !Number.isFinite(keepInPromptChars) ||
          keepInPromptChars === undefined ||
          keepInPromptChars < 0
        ) {
          throw new Error(
            `contextField "${field}" keepInPromptChars must be a finite number >= 0`
          );
        }
        promptConfigByField.set(field, {
          kind: 'truncate',
          keepInPromptChars,
          reverseTruncate: cf.reverseTruncate === true,
        });
        continue;
      }

      const promptMaxChars = cf.promptMaxChars ?? defaultPromptMaxChars;
      if (!Number.isFinite(promptMaxChars) || promptMaxChars < 0) {
        throw new Error(
          `contextField "${field}" promptMaxChars must be a finite number >= 0`
        );
      }
      promptConfigByField.set(field, {
        kind: 'threshold',
        promptMaxChars,
      });
    }
  }

  return { contextFieldNames, promptConfigByField };
}

const MAX_SHAPE_KEYS = 12;

/**
 * Shape hint for a runtime-only value: field names of the first element of an
 * array-of-objects, or the top-level keys of a plain object. Actors write
 * code against these values without seeing them — surfacing the real field
 * names prevents blind guessing (e.g. `txn.amount` vs `txn.amountCents`).
 */
export function describeValueShape(value: unknown): string | undefined {
  const keysOf = (obj: object): string =>
    Object.keys(obj).slice(0, MAX_SHAPE_KEYS).join(', ');
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const keys = keysOf(first);
      return keys ? `item keys: ${keys}` : undefined;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const keys = keysOf(value);
    return keys ? `keys: ${keys}` : undefined;
  }
  return undefined;
}

export function buildRLMVariablesInfo(
  contextValues: Record<string, unknown>,
  options?: {
    promptConfigByField?: ReadonlyMap<string, AxContextFieldPromptConfig>;
    inlinedFields?: ReadonlySet<string>;
  }
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(contextValues)) {
    const valueType = Array.isArray(value) ? 'array' : typeof value;
    const size =
      typeof value === 'string'
        ? `${value.length} chars`
        : Array.isArray(value)
          ? `${value.length} items`
          : value && typeof value === 'object'
            ? `${Object.keys(value as Record<string, unknown>).length} keys`
            : 'n/a';
    const promptConfig = options?.promptConfigByField?.get(key);
    const promptMode =
      promptConfig === undefined
        ? 'runtime-only'
        : describeContextFieldPromptMode(
            value,
            promptConfig,
            options?.inlinedFields?.has(key) === true
          );
    const shape = describeValueShape(value);
    lines.push(
      `- ${key}: type=${valueType}, size=${size}, prompt=${promptMode}${shape ? `, ${shape}` : ''}`
    );
  }
  return lines.join('\n');
}

export async function runWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
  stopSignal?: AbortSignal
): Promise<TOut[]> {
  if (items.length === 0) {
    return [];
  }

  const results: TOut[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      if (stopSignal?.aborted) {
        return;
      }
      const current = cursor++;
      if (current >= items.length) {
        return;
      }
      const item = items[current];
      if (item === undefined) {
        return;
      }
      results[current] = await worker(item, current);
    }
  });

  await Promise.all(workers);
  return results;
}

export function shouldEnforceIncrementalConsoleTurns(
  runtimeUsageInstructions: string,
  options?: Readonly<{ isJavaScriptRuntime?: boolean }>
): boolean {
  if (options?.isJavaScriptRuntime === false) {
    return false;
  }
  return runtimeUsageInstructions.includes('console.log');
}

export type ActorTurnCodePolicyResult = {
  violation?: string;
  /** Discovery code to run first when auto-splitting a mixed discovery+code turn. */
  autoSplitDiscoveryCode?: string;
};

export function validateActorTurnCodePolicy(
  code: string
): ActorTurnCodePolicyResult | undefined {
  const sanitized = stripJsStringsAndComments(code);
  const statements = splitTopLevelStatements(sanitized);
  const completionStatementIndex = statements.findIndex((statement) =>
    hasCompletionSignalCall(statement)
  );
  const reachableStatements =
    completionStatementIndex >= 0
      ? statements.slice(0, completionStatementIndex + 1)
      : statements;
  const reachableCode = reachableStatements.join(';\n');
  const hasConsoleLog = /\bconsole\s*\.\s*log\s*\(/.test(reachableCode);
  const originalStatements = splitTopLevelStatements(code);
  const discoveryCode =
    completionStatementIndex >= 0
      ? statements.slice(0, completionStatementIndex).join(';\n')
      : sanitized;
  const originalDiscoveryCode =
    completionStatementIndex >= 0
      ? originalStatements.slice(0, completionStatementIndex).join(';\n')
      : code;
  const discoveryAnalysis = analyzeDiscoveryTurnPolicy(
    discoveryCode,
    originalDiscoveryCode
  );

  if (discoveryAnalysis.violation) {
    return { violation: discoveryAnalysis.violation };
  }

  // Auto-split: discovery mixed with other code — run discovery first,
  // but still validate the remaining code against turn discipline policies.
  const autoSplitDiscoveryCode =
    discoveryAnalysis.autoSplitDiscoveryCode ?? undefined;

  if (completionStatementIndex >= 0) {
    // Completion turn with auto-split: run discovery, then execute the code
    return autoSplitDiscoveryCode ? { autoSplitDiscoveryCode } : undefined;
  }

  if (discoveryAnalysis.isDiscoveryOnly && !hasConsoleLog) {
    return undefined;
  }

  if (!hasConsoleLog) {
    return {
      autoSplitDiscoveryCode,
      violation:
        '[POLICY] Non-final turns must include at least one console.log(...) so the next turn can reason from its output. If you called a tool or function, capture its return value first, e.g. `const result = await tool.call(args)`, then either `console.log(result)` to inspect it or `await final("...", { result })` if the task is complete.',
    };
  }

  // Auto-split with valid console.log: run discovery first, then the full code
  return autoSplitDiscoveryCode ? { autoSplitDiscoveryCode } : undefined;
}

type NamedCallMatch = {
  name: string;
  startIndex: number;
  openParenIndex: number;
  closeParenIndex?: number;
};

type DiscoveryTurnPolicyAnalysis = {
  isDiscoveryOnly: boolean;
  violation?: string;
  /** When discovery is mixed with other code, the discovery-only portion. */
  autoSplitDiscoveryCode?: string;
};

function analyzeDiscoveryTurnPolicy(
  sanitizedCode: string,
  originalCode?: string
): DiscoveryTurnPolicyAnalysis {
  const discoverCalls = findNamedCalls(sanitizedCode, [
    DISCOVERY_DISCOVER_NAME,
  ]);
  const memoriesCalls = findNamedCalls(sanitizedCode, [MEMORIES_LOAD_NAME]);
  const discoveryCalls = [...discoverCalls, ...memoriesCalls].sort(
    (left, right) => left.startIndex - right.startIndex
  );

  if (discoveryCalls.length === 0) {
    return { isDiscoveryOnly: false };
  }

  const promiseAllCalls = findNamedCalls(sanitizedCode, ['Promise.all']);
  for (const promiseAllCall of promiseAllCalls) {
    if (promiseAllCall.closeParenIndex === undefined) {
      continue;
    }
    const promiseAllBody = sanitizedCode.slice(
      promiseAllCall.openParenIndex + 1,
      promiseAllCall.closeParenIndex
    );
    if (promiseAllBody.includes(DISCOVERY_DISCOVER_NAME)) {
      return {
        isDiscoveryOnly: false,
        violation:
          "[POLICY] Batch tool/skill discovery into one call: use `await discover(['tasks', 'contact.lookup'])` or `await discover({ tools: ['tasks'], skills: ['release checklist'] })`, not repeated `discover(...)` calls or `Promise.all(...)`.",
      };
    }
    if (promiseAllBody.includes(MEMORIES_LOAD_NAME)) {
      return {
        isDiscoveryOnly: false,
        violation:
          "[POLICY] Batch memory loading into one array call: use `await recall(['queryA', 'queryB'])`, not repeated `recall(...)` calls or `Promise.all(...)`.",
      };
    }
  }

  if (discoverCalls.length > 1) {
    return {
      isDiscoveryOnly: false,
      violation:
        "[POLICY] Batch tool/skill discovery into one call: use `await discover(['tasks', 'contact.lookup'])` or `await discover({ tools: ['tasks'], skills: ['release checklist'] })`, not repeated `discover(...)` calls or `Promise.all(...)`.",
    };
  }

  if (memoriesCalls.length > 1) {
    return {
      isDiscoveryOnly: false,
      violation:
        "[POLICY] Batch memory loading into one array call: use `await recall(['queryA', 'queryB'])`, not repeated `recall(...)` calls or `Promise.all(...)`.",
    };
  }

  const statements = splitTopLevelStatements(sanitizedCode);
  if (
    statements.length === 0 ||
    !statements.every((statement) => isAllowedDiscoveryOnlyStatement(statement))
  ) {
    // Auto-split: extract discovery statements so the caller can run them
    // first, then execute the full code block. Use the original (unsanitized)
    // code so that string arguments (e.g. module names) are preserved.
    const originalStatements = originalCode
      ? splitTopLevelStatements(originalCode)
      : statements;
    const discoveryIndices: number[] = [];
    for (let i = 0; i < statements.length; i++) {
      if (isAllowedDiscoveryOnlyStatement(statements[i]!)) {
        discoveryIndices.push(i);
      }
    }
    if (discoveryIndices.length > 0) {
      const originalDiscoveryStatements = discoveryIndices
        .map((idx) => originalStatements[idx])
        .filter((s): s is string => s !== undefined);
      if (originalDiscoveryStatements.length > 0) {
        return {
          isDiscoveryOnly: false,
          autoSplitDiscoveryCode: originalDiscoveryStatements.join(';\n'),
        };
      }
    }
    return {
      isDiscoveryOnly: false,
      violation:
        '[POLICY] Discovery calls (discover/recall) must be in their own turn — do not combine them with other code. Run discovery first, then use the results in the next turn.',
    };
  }

  return { isDiscoveryOnly: true };
}

function findNamedCalls(
  sanitizedCode: string,
  names: readonly string[]
): NamedCallMatch[] {
  const calls: NamedCallMatch[] = [];

  for (const name of names) {
    const escapedName = escapeRegExp(name).replace(/\\\./g, '\\s*\\.\\s*');
    const pattern = new RegExp(`\\b${escapedName}\\s*\\(`, 'g');

    for (const match of sanitizedCode.matchAll(pattern)) {
      const fullMatch = match[0];
      if (fullMatch === undefined) {
        continue;
      }
      const matchIndex = match.index ?? -1;
      if (matchIndex < 0) {
        continue;
      }
      const openParenOffset = fullMatch.lastIndexOf('(');
      const openParenIndex = matchIndex + openParenOffset;
      calls.push({
        name,
        startIndex: matchIndex,
        openParenIndex,
        closeParenIndex: findMatchingParenIndex(sanitizedCode, openParenIndex),
      });
    }
  }

  return calls.sort((left, right) => left.startIndex - right.startIndex);
}

function splitTopLevelStatements(code: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === '[') {
      bracketDepth++;
      continue;
    }
    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    const isBoundary = ch === ';' || ch === '\n';
    if (!isBoundary || parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) {
      continue;
    }

    const statement = code.slice(start, i).trim();
    if (statement) {
      statements.push(statement);
    }
    start = i + 1;
  }

  const trailing = code.slice(start).trim();
  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

function isAllowedDiscoveryOnlyStatement(statement: string): boolean {
  return (
    /^(?:await\s+)?(?:discover|recall)\s*\([\s\S]*\)$/.test(statement) ||
    /^(?:const|let|var)\s+[\s\S]+?=\s*(?:await\s+)?(?:discover|recall)\s*\([\s\S]*\)$/.test(
      statement
    )
  );
}

function _findConsoleLogCalls(
  sanitizedCode: string
): Array<{ closeParenIndex?: number }> {
  const matches = sanitizedCode.matchAll(/\bconsole\s*\.\s*log\s*\(/g);
  const calls: Array<{ closeParenIndex?: number }> = [];

  for (const match of matches) {
    const fullMatch = match[0];
    if (fullMatch === undefined) {
      continue;
    }
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    const openParenOffset = fullMatch.lastIndexOf('(');
    const openParenIndex = matchIndex + openParenOffset;
    const closeParenIndex = findMatchingParenIndex(
      sanitizedCode,
      openParenIndex
    );
    calls.push({ closeParenIndex });
  }

  return calls;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingParenIndex(
  code: string,
  openParenIndex: number
): number | undefined {
  if (openParenIndex < 0 || code[openParenIndex] !== '(') {
    return undefined;
  }

  let depth = 0;
  for (let i = openParenIndex; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return undefined;
}
