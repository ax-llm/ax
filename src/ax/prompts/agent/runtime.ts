import type { AxFunctionJSONSchema } from '../../ai/types.js';
import type { AxIField } from '../../dsp/sig.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import {
  type AxAIServiceAbortedError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../../util/apicall.js';
import { stripJsStringsAndComments } from '../../util/jsAnalysis.js';
import type {
  AxAgentFunction,
  AxAgentFunctionExample,
  AxAgentFunctionCollection,
  AxAgentFunctionGroup,
  AxAgentFunctionModuleMeta,
  AxContextFieldInput,
  AxContextFieldPromptConfig,
  NormalizedAgentFunctionCollection,
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
export const DISCOVERY_LIST_MODULE_FUNCTIONS_NAME = 'listModuleFunctions';
export const DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME = 'getFunctionDefinitions';
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
    examplesInSystem: options?.examplesInSystem,
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
  error: AxAgentClarificationError | AxAIServiceAbortedError,
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

export function hasCompletionSignalCall(code: string): boolean {
  const sanitized = stripJsStringsAndComments(code);
  return (
    /\bfinal\s*\(/.test(sanitized) || /\baskClarification\s*\(/.test(sanitized)
  );
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
    return 'runtime-only (keepInPromptChars requires string)';
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

function estimateValueSize(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
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
    lines.push(
      `- ${key}: type=${valueType}, size=${size}, prompt=${promptMode}`
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
  runtimeUsageInstructions: string
): boolean {
  return runtimeUsageInstructions.includes('console.log');
}

export function validateActorTurnCodePolicy(code: string): string | undefined {
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
  const consoleLogCalls = findConsoleLogCalls(reachableCode);
  const discoveryCode =
    completionStatementIndex >= 0
      ? statements.slice(0, completionStatementIndex).join(';\n')
      : sanitized;
  const discoveryAnalysis = analyzeDiscoveryTurnPolicy(discoveryCode);

  if (discoveryAnalysis.violation) {
    return discoveryAnalysis.violation;
  }

  if (completionStatementIndex >= 0) {
    if (consoleLogCalls.length > 0) {
      return '[POLICY] Do not combine console.log(...) with final(...)/askClarification(...) in the same turn. Inspect in one turn, then complete in the next turn.';
    }
    return undefined;
  }

  if (discoveryAnalysis.isDiscoveryOnly && consoleLogCalls.length === 0) {
    return undefined;
  }

  if (consoleLogCalls.length === 0) {
    return '[POLICY] Non-final turns must include exactly one console.log(...) so the next turn can reason from its output.';
  }

  if (consoleLogCalls.length > 1) {
    return '[POLICY] Use exactly one console.log(...) per non-final turn, then stop.';
  }

  const onlyLog = consoleLogCalls[0];
  if (onlyLog === undefined) {
    return '[POLICY] Unable to verify console.log(...) usage. Emit exactly one console.log(...) per non-final turn.';
  }
  if (onlyLog.closeParenIndex === undefined) {
    return '[POLICY] Could not parse console.log(...). Keep a single valid console.log(...) call as the last statement in non-final turns.';
  }

  const trailing = sanitized
    .slice(onlyLog.closeParenIndex + 1)
    .replace(/^[\s;]+/, '');
  if (trailing.length > 0) {
    return '[POLICY] End non-final turns immediately after console.log(...). Do not execute additional statements after logging.';
  }

  return undefined;
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
};

function analyzeDiscoveryTurnPolicy(
  sanitizedCode: string
): DiscoveryTurnPolicyAnalysis {
  const listCalls = findNamedCalls(sanitizedCode, [
    DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
  ]);
  const definitionCalls = findNamedCalls(sanitizedCode, [
    DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
  ]);
  const discoveryCalls = [...listCalls, ...definitionCalls].sort(
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
    if (promiseAllBody.includes(DISCOVERY_LIST_MODULE_FUNCTIONS_NAME)) {
      return {
        isDiscoveryOnly: false,
        violation:
          "[POLICY] Batch module discovery into one array call: use `await listModuleFunctions(['tasks', 'contact'])`, not repeated `listModuleFunctions(...)` calls or `Promise.all(...)`.",
      };
    }
    if (promiseAllBody.includes(DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME)) {
      return {
        isDiscoveryOnly: false,
        violation:
          "[POLICY] Batch function-definition discovery into one array call: use `await getFunctionDefinitions(['mod.funcA', 'mod.funcB'])`, not repeated `getFunctionDefinitions(...)` calls or `Promise.all(...)`.",
      };
    }
  }

  if (listCalls.length > 1) {
    return {
      isDiscoveryOnly: false,
      violation:
        "[POLICY] Batch module discovery into one array call: use `await listModuleFunctions(['tasks', 'contact'])`, not repeated `listModuleFunctions(...)` calls or `Promise.all(...)`.",
    };
  }

  if (definitionCalls.length > 1) {
    return {
      isDiscoveryOnly: false,
      violation:
        "[POLICY] Batch function-definition discovery into one array call: use `await getFunctionDefinitions(['mod.funcA', 'mod.funcB'])`, not repeated `getFunctionDefinitions(...)` calls or `Promise.all(...)`.",
    };
  }

  const statements = splitTopLevelStatements(sanitizedCode);
  if (
    statements.length === 0 ||
    !statements.every((statement) => isAllowedDiscoveryOnlyStatement(statement))
  ) {
    return { isDiscoveryOnly: false };
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
    /^(?:await\s+)?(?:listModuleFunctions|getFunctionDefinitions)\s*\([\s\S]*\)$/.test(
      statement
    ) ||
    /^(?:const|let|var)\s+[\s\S]+?=\s*(?:await\s+)?(?:listModuleFunctions|getFunctionDefinitions)\s*\([\s\S]*\)$/.test(
      statement
    )
  );
}

function findConsoleLogCalls(
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

/**
 * Returns a copy of `schema` with the listed property names removed from
 * both `properties` and `required`.  Used to strip parent-injected shared
 * fields from a child agent's public function signature.
 */
export function stripSchemaProperties(
  schema: AxFunctionJSONSchema,
  namesToRemove: ReadonlySet<string>
): AxFunctionJSONSchema {
  if (!schema.properties || namesToRemove.size === 0) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => !namesToRemove.has(k))
  );
  const required = schema.required?.filter((k) => !namesToRemove.has(k));
  return {
    ...schema,
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

export type DiscoveryCallableMeta = {
  module: string;
  name: string;
  description?: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
  examples?: readonly AxAgentFunctionExample[];
};

export function normalizeAgentModuleNamespace(
  namespace: string,
  options?: Readonly<{ normalize?: boolean }>
): string {
  const trimmed = namespace.trim();
  const shouldNormalize = options?.normalize ?? true;
  const normalized = shouldNormalize ? toCamelCase(trimmed) : trimmed;
  if (!normalized) {
    throw new Error('Agent module namespace must contain letters or numbers');
  }
  return normalized;
}

function isAgentFunctionGroup(
  value: AxAgentFunction | AxAgentFunctionGroup
): value is AxAgentFunctionGroup {
  return Array.isArray((value as AxAgentFunctionGroup).functions);
}

export function normalizeAgentFunctionCollection(
  collection: AxAgentFunctionCollection | undefined,
  reservedNames: ReadonlySet<string>
): NormalizedAgentFunctionCollection {
  if (!collection || collection.length === 0) {
    return { functions: [], moduleMetadata: [] };
  }

  const allGroups = collection.every((item) =>
    isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );
  const allFunctions = collection.every(
    (item) =>
      !isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );

  if (!allGroups && !allFunctions) {
    throw new Error(
      'Agent functions collections must contain either flat functions or grouped function modules, not both'
    );
  }

  if (allFunctions) {
    return {
      functions: [...(collection as readonly AxAgentFunction[])],
      moduleMetadata: [],
    };
  }

  const seenNamespaces = new Set<string>();
  const moduleMetadata: AxAgentFunctionModuleMeta[] = [];
  const functions: AxAgentFunction[] = [];

  for (const group of collection as readonly AxAgentFunctionGroup[]) {
    const namespace = group.namespace.trim();
    const title = group.title.trim();
    const selectionCriteria = group.selectionCriteria?.trim() || undefined;
    const description = group.description?.trim() || undefined;

    if (!namespace) {
      throw new Error(
        'Agent function group namespace must be a non-empty string'
      );
    }
    if (!title) {
      throw new Error(
        `Agent function group "${namespace}" must define a non-empty title`
      );
    }
    if (reservedNames.has(namespace)) {
      throw new Error(
        `Agent function namespace "${namespace}" conflicts with an AxAgent runtime global and is reserved`
      );
    }
    if (seenNamespaces.has(namespace)) {
      throw new Error(
        `Duplicate agent function group namespace "${namespace}"`
      );
    }
    if (group.functions.length === 0) {
      throw new Error(
        `Agent function group "${namespace}" must contain at least one function`
      );
    }

    seenNamespaces.add(namespace);
    moduleMetadata.push({
      namespace,
      title,
      selectionCriteria,
      description,
    });

    for (const fn of group.functions) {
      if ('namespace' in fn && fn.namespace !== undefined) {
        throw new Error(
          `Grouped agent function "${namespace}.${fn.name}" must not define namespace; use the parent group namespace instead`
        );
      }

      functions.push({
        ...fn,
        namespace,
      });
    }
  }

  return { functions, moduleMetadata };
}

export function normalizeDiscoveryStringInput(
  value: unknown,
  fieldName: string
): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${fieldName} must be a non-empty string`);
    }
    return [trimmed];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a string or string[]`);
  }

  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} must contain only strings`);
  }

  const normalized = value
    .map((item) => item as string)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty string`);
  }

  return [...new Set(normalized)];
}

export function compareCanonicalDiscoveryStrings(
  left: string,
  right: string
): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function sortDiscoveryModules(modules: readonly string[]): string[] {
  return [...modules].sort(compareCanonicalDiscoveryStrings);
}

export function normalizeDiscoveryCallableIdentifier(
  identifier: string
): string {
  const trimmed = identifier.trim();
  return trimmed.includes('.') ? trimmed : `utils.${trimmed}`;
}

export function normalizeAndSortDiscoveryFunctionIdentifiers(
  identifiers: readonly string[]
): string[] {
  return [
    ...new Set(
      identifiers.map((identifier) =>
        normalizeDiscoveryCallableIdentifier(identifier)
      )
    ),
  ].sort(compareCanonicalDiscoveryStrings);
}

export function resolveDiscoveryCallableNamespaces(
  identifiers: readonly string[],
  callableLookup: ReadonlyMap<string, DiscoveryCallableMeta>
): string[] {
  const namespaces = new Set<string>();

  for (const rawIdentifier of identifiers) {
    const qualifiedName = normalizeDiscoveryCallableIdentifier(rawIdentifier);
    const meta = callableLookup.get(qualifiedName);
    if (meta) {
      namespaces.add(meta.module);
    }
  }

  return [...namespaces];
}

function normalizeSchemaTypesForDiscovery(
  schema: AxFunctionJSONSchema
): string[] {
  const rawType = (schema as { type?: unknown }).type;
  if (Array.isArray(rawType)) {
    return rawType.filter((t): t is string => typeof t === 'string');
  }
  if (typeof rawType === 'string') {
    if (rawType.includes(',')) {
      return rawType
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [rawType];
  }
  return [];
}

function isJsonAnyTypeUnionForDiscovery(types: readonly string[]): boolean {
  const normalized = new Set(types);
  return (
    normalized.has('object') &&
    normalized.has('array') &&
    normalized.has('string') &&
    normalized.has('number') &&
    normalized.has('boolean') &&
    normalized.has('null')
  );
}

function schemaTypeToShortStringForDiscovery(
  schema: AxFunctionJSONSchema
): string {
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ');

  const types = normalizeSchemaTypesForDiscovery(schema);
  if (types.length === 0) return 'unknown';
  if (isJsonAnyTypeUnionForDiscovery(types)) return 'any';

  const rendered = [...new Set(types)].map((type) => {
    if (type === 'array') {
      const itemType = schema.items
        ? schemaTypeToShortStringForDiscovery(schema.items)
        : 'unknown';
      return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
    }
    if (type === 'object') {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        return renderObjectTypeForDiscovery(schema);
      }
      return 'object';
    }
    return type;
  });

  return rendered.length > 1
    ? rendered.join(' | ')
    : (rendered[0] ?? 'unknown');
}

function renderObjectTypeForDiscovery(
  schema: AxFunctionJSONSchema | undefined,
  options?: Readonly<{ respectRequired?: boolean }>
): string {
  if (!schema) {
    return '{}';
  }

  const hasProperties =
    !!schema.properties && Object.keys(schema.properties).length > 0;
  const supportsExtraProps = schema.additionalProperties === true;

  if (!hasProperties) {
    return supportsExtraProps ? '{ [key: string]: unknown }' : '{}';
  }

  const required = new Set(schema.required ?? []);
  const respectRequired = options?.respectRequired ?? false;
  const parts = Object.entries(schema.properties!).map(([key, prop]) => {
    const typeStr = schemaTypeToShortStringForDiscovery(prop);
    const optionalMarker = respectRequired && !required.has(key) ? '?' : '';
    return `${key}${optionalMarker}: ${typeStr}`;
  });
  if (schema.additionalProperties === true) {
    parts.push('[key: string]: unknown');
  }

  return `{ ${parts.join(', ')} }`;
}

function renderCallableEntryForDiscovery(args: {
  qualifiedName: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  const paramType = renderObjectTypeForDiscovery(args.parameters, {
    respectRequired: true,
  });
  const returnType = args.returns
    ? `: Promise<${schemaTypeToShortStringForDiscovery(args.returns)}>`
    : '';
  return `- \`${args.qualifiedName}(args: ${paramType})${returnType}\``;
}

type DiscoveryArgDoc = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

function collectDiscoveryArgumentDocs(
  schema: AxFunctionJSONSchema | undefined,
  prefix = '',
  includeRequired = true
): DiscoveryArgDoc[] {
  if (!schema?.properties) {
    return [];
  }

  const required = new Set(schema.required ?? []);
  const docs: DiscoveryArgDoc[] = [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const description = prop.description?.trim();
    if (description) {
      docs.push({
        name: path,
        type: schemaTypeToShortStringForDiscovery(prop),
        required: includeRequired ? required.has(key) : undefined,
        description,
      });
    }

    const propTypes = normalizeSchemaTypesForDiscovery(prop);
    if (propTypes.includes('object') && prop.properties) {
      docs.push(...collectDiscoveryArgumentDocs(prop, path, false));
    }

    if (propTypes.includes('array') && prop.items) {
      const itemDescription = (
        prop.items as AxFunctionJSONSchema & { description?: string }
      ).description?.trim();
      const itemPath = `${path}[]`;
      if (itemDescription) {
        docs.push({
          name: itemPath,
          type: schemaTypeToShortStringForDiscovery(prop.items),
          description: itemDescription,
        });
      }
      const itemTypes = normalizeSchemaTypesForDiscovery(prop.items);
      if (itemTypes.includes('object') && prop.items.properties) {
        docs.push(...collectDiscoveryArgumentDocs(prop.items, itemPath, false));
      }
    }
  }

  return docs;
}

function renderDiscoveryArgumentDocsMarkdown(
  schema: AxFunctionJSONSchema | undefined
): string | undefined {
  const docs = collectDiscoveryArgumentDocs(schema);
  if (docs.length === 0) {
    return undefined;
  }

  return [
    '#### Arguments',
    ...docs.map((doc) => {
      const suffix =
        doc.required === undefined
          ? `\`${doc.type}\``
          : `\`${doc.type}\`, ${doc.required ? 'required' : 'optional'}`;
      return `- \`${doc.name}\` (${suffix}): ${doc.description}`;
    }),
  ].join('\n');
}

function renderDiscoveryExamplesMarkdown(
  examples: readonly AxAgentFunctionExample[] | undefined
): string | undefined {
  if (!examples || examples.length === 0) {
    return undefined;
  }

  const blocks = examples
    .map((example) => {
      const parts: string[] = [];
      if (example.title?.trim()) {
        parts.push(`##### ${example.title.trim()}`);
      }
      if (example.description?.trim()) {
        parts.push(example.description.trim());
      }
      parts.push(`\`\`\`${example.language?.trim() || 'typescript'}`);
      parts.push(example.code);
      parts.push('```');
      return parts.join('\n');
    })
    .join('\n\n');

  return ['#### Examples', blocks].join('\n');
}

export function renderDiscoveryModuleListMarkdown(
  modules: readonly string[],
  moduleLookup: ReadonlyMap<string, readonly string[]>,
  moduleMetaLookup: ReadonlyMap<string, AxAgentFunctionModuleMeta>
): string {
  return sortDiscoveryModules(modules)
    .map((module) => {
      const functions = [...(moduleLookup.get(module) ?? [])]
        .map((qualifiedName) => qualifiedName.split('.').pop() ?? qualifiedName)
        .sort(compareCanonicalDiscoveryStrings);
      const exists = functions.length > 0;
      const meta = exists ? moduleMetaLookup.get(module) : undefined;
      const body = exists
        ? functions.map((name) => `- \`${name}\``).join('\n')
        : `- Error: module \`${module}\` does not exist.`;
      const parts = [`### Module \`${module}\``];
      if (meta) {
        parts.push(`**${meta.title}**`);
      }
      parts.push(body);
      if (meta?.description) {
        parts.push(meta.description);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

export function renderDiscoveryFunctionDefinitionsMarkdown(
  identifiers: readonly string[],
  callableLookup: ReadonlyMap<string, DiscoveryCallableMeta>
): string {
  return normalizeAndSortDiscoveryFunctionIdentifiers(identifiers)
    .map((qualifiedName) => {
      const meta = callableLookup.get(qualifiedName);
      if (!meta) {
        return `### \`${qualifiedName}\`\n- Not found.`;
      }
      return [
        `### \`${qualifiedName}\``,
        meta.description,
        renderCallableEntryForDiscovery({
          qualifiedName,
          parameters: meta.parameters,
          returns: meta.returns,
        }),
        renderDiscoveryArgumentDocsMarkdown(meta.parameters),
        renderDiscoveryExamplesMarkdown(meta.examples),
      ]
        .filter((part): part is string => !!part)
        .join('\n');
    })
    .join('\n\n');
}

export function toCamelCase(inputString: string): string {
  const parts = inputString
    .trim()
    .split(/[^A-Za-z0-9_$]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
