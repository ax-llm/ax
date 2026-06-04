import type {
  AxCodeSessionSnapshot,
  AxCodeSessionSnapshotEntry,
} from '../agent/rlm.js';
import {
  extractTopLevelDeclaredNames,
  stripJsStringsAndComments,
} from '../util/jsAnalysis.js';
import { FUNCTION_REF_KEY, MAX_ERROR_CAUSE_DEPTH } from './worker.js';

export const splitGlobalsForWorker = (
  globals?: Record<string, unknown>,
  options?: Readonly<{ nextFnId?: () => number }>
) => {
  const serializableGlobals: Record<string, unknown> = {};
  const fnMap = new Map<string, (...args: unknown[]) => unknown>();
  let nextFnId = 0;
  const seen = new WeakMap<object, unknown>();

  const toSerializable = (value: unknown, path: string): unknown => {
    if (typeof value === 'function') {
      const refId = options?.nextFnId ? options.nextFnId() : ++nextFnId;
      const ref = `fn_${refId}_${path || 'root'}`;
      fnMap.set(ref, value as (...args: unknown[]) => unknown);
      return { [FUNCTION_REF_KEY]: ref };
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value as object)) {
      return seen.get(value as object);
    }

    if (Array.isArray(value)) {
      const arr: unknown[] = [];
      seen.set(value, arr);
      for (let i = 0; i < value.length; i += 1) {
        arr[i] = toSerializable(value[i], `${path}[${i}]`);
      }
      return arr;
    }

    const proto = Object.getPrototypeOf(value);
    const isPlainObject = proto === Object.prototype || proto === null;
    if (!isPlainObject) {
      return value;
    }

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(obj)) {
      out[k] = toSerializable(v, path ? `${path}.${k}` : k);
    }
    return out;
  };

  if (globals) {
    for (const [key, value] of Object.entries(globals)) {
      serializableGlobals[key] = toSerializable(value, key);
    }
  }

  return { serializableGlobals, fnMap };
};

export const validateSerializableGlobals = (
  globals: Record<string, unknown>
): void => {
  if (typeof structuredClone !== 'function') {
    return;
  }

  try {
    structuredClone(globals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`RLM globals must be structured-cloneable: ${message}`);
  }
};

const isIdentifierChar = (ch: string | undefined): boolean =>
  !!ch && /[A-Za-z0-9_$]/.test(ch);

const isIdentifierStart = (ch: string | undefined): boolean =>
  !!ch && /[A-Za-z_$]/.test(ch);

export const findReservedRuntimeNameViolation = (
  code: string,
  reservedNames: readonly string[]
): string | undefined => {
  const reserved = new Set(reservedNames);

  for (const name of extractTopLevelDeclaredNames(code)) {
    if (reserved.has(name)) {
      return name;
    }
  }

  const sanitized = stripJsStringsAndComments(code);
  const len = sanitized.length;
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;

  const skipWhitespace = (index: number): number => {
    let current = index;
    while (current < len && /\s/.test(sanitized[current] ?? '')) {
      current++;
    }
    return current;
  };

  const previousNonWhitespaceIndex = (index: number): number => {
    let current = index;
    while (current >= 0 && /\s/.test(sanitized[current] ?? '')) {
      current--;
    }
    return current;
  };

  const isStatementBoundary = (index: number): boolean => {
    const prevIndex = previousNonWhitespaceIndex(index - 1);
    if (prevIndex < 0) return true;
    const prev = sanitized[prevIndex];
    return prev === '\n' || prev === ';' || prev === '{' || prev === '}';
  };

  const readWord = (): string => {
    const start = i;
    while (i < len && isIdentifierChar(sanitized[i])) {
      i++;
    }
    return sanitized.slice(start, i);
  };

  const isAssignmentOperatorAt = (index: number): boolean => {
    const twoChars = sanitized.slice(index, index + 2);
    const threeChars = sanitized.slice(index, index + 3);

    if (threeChars === '===' || twoChars === '==' || twoChars === '=>') {
      return false;
    }

    return (
      sanitized[index] === '=' ||
      [
        '+=',
        '-=',
        '*=',
        '/=',
        '%=',
        '&=',
        '|=',
        '^=',
        '&&=',
        '||=',
        '??=',
        '**=',
        '<<=',
        '>>=',
        '>>>=',
      ].some((op) => sanitized.startsWith(op, index))
    );
  };

  while (i < len) {
    const ch = sanitized[i]!;

    if (ch === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      i++;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      i++;
      continue;
    }

    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {
      const wordStart = i;
      const word = readWord();

      if (
        (word === 'function' || word === 'class') &&
        isStatementBoundary(wordStart)
      ) {
        const nameStart = skipWhitespace(i);
        if (isIdentifierStart(sanitized[nameStart])) {
          let nameEnd = nameStart + 1;
          while (nameEnd < len && isIdentifierChar(sanitized[nameEnd])) {
            nameEnd++;
          }
          const declaredName = sanitized.slice(nameStart, nameEnd);
          if (reserved.has(declaredName)) {
            return declaredName;
          }
        }
        continue;
      }

      if (word === 'async' && isStatementBoundary(wordStart)) {
        const keywordIndex = skipWhitespace(i);
        if (sanitized.startsWith('function', keywordIndex)) {
          const nameStart = skipWhitespace(keywordIndex + 'function'.length);
          if (isIdentifierStart(sanitized[nameStart])) {
            let nameEnd = nameStart + 1;
            while (nameEnd < len && isIdentifierChar(sanitized[nameEnd])) {
              nameEnd++;
            }
            const declaredName = sanitized.slice(nameStart, nameEnd);
            if (reserved.has(declaredName)) {
              return declaredName;
            }
          }
        }
        continue;
      }

      if (reserved.has(word)) {
        const prevIndex = previousNonWhitespaceIndex(wordStart - 1);
        const prev = prevIndex >= 0 ? sanitized[prevIndex] : undefined;
        const nextIndex = skipWhitespace(i);

        const isMemberAccess =
          prev === '.' ||
          prev === '?' ||
          (prev === '[' && sanitized[nextIndex] === ']');
        const isUpdate =
          sanitized.startsWith('++', nextIndex) ||
          sanitized.startsWith('--', nextIndex) ||
          (prevIndex > 0 &&
            (sanitized.slice(prevIndex - 1, prevIndex + 1) === '++' ||
              sanitized.slice(prevIndex - 1, prevIndex + 1) === '--'));

        if (
          !isMemberAccess &&
          (isUpdate || isAssignmentOperatorAt(nextIndex))
        ) {
          return word;
        }
      }

      continue;
    }

    i++;
  }

  return undefined;
};

/** Structured error payload sent across worker boundary (supports recursive cause). */
export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: string | SerializedError;
  /** Optional structured-cloneable payload (array, object, string, number, etc.). */
  data?: unknown;
};

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function serializeError(
  err: unknown,
  maxDepth: number = MAX_ERROR_CAUSE_DEPTH,
  depth: number = 0,
  seen: Set<object> = new Set()
): SerializedError | string {
  if (depth > maxDepth) {
    return { name: 'Error', message: '[cause chain truncated]' };
  }
  if (err !== null && typeof err === 'object') {
    if (seen.has(err as object)) {
      return { name: 'Error', message: '[circular]' };
    }
    seen.add(err as object);
  }
  const name =
    err !== null &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name != null
      ? String((err as { name: unknown }).name)
      : 'Error';
  const message =
    err !== null &&
    typeof err === 'object' &&
    (err as { message?: unknown }).message != null
      ? String((err as { message: unknown }).message)
      : safeStringify(err);
  const stack =
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { stack?: unknown }).stack === 'string'
      ? (err as { stack: string }).stack
      : undefined;
  let cause: string | SerializedError | undefined;
  const errObj = err as { cause?: unknown } | null;
  if (
    errObj &&
    typeof errObj === 'object' &&
    errObj.cause !== undefined &&
    depth < maxDepth
  ) {
    try {
      const c = errObj.cause;
      if (
        c instanceof Error ||
        (c !== null && typeof c === 'object' && ('message' in c || 'name' in c))
      ) {
        cause = serializeError(c, maxDepth, depth + 1, seen) as SerializedError;
      } else {
        cause = { name: 'Error', message: safeStringify(c) };
      }
    } catch {
      cause = { name: 'Error', message: safeStringify(errObj.cause) };
    }
  }
  const out: SerializedError = { name, message };
  if (stack !== undefined) out.stack = stack;
  if (cause !== undefined) out.cause = cause;
  const errWithData = err as { data?: unknown } | null;
  if (
    errWithData &&
    typeof errWithData === 'object' &&
    'data' in errWithData &&
    errWithData.data !== undefined
  ) {
    try {
      if (typeof structuredClone === 'function') {
        out.data = structuredClone(errWithData.data);
      } else {
        out.data = errWithData.data;
      }
    } catch {
      // Non-cloneable data omitted
    }
  }
  return out;
}

export function deserializeError(payload: string | SerializedError): Error {
  if (typeof payload === 'string') {
    return new Error(payload);
  }
  if (!payload || typeof payload !== 'object') {
    return new Error(String(payload));
  }
  const message =
    payload.message != null ? String(payload.message) : 'Unknown error';
  const err = new Error(message);
  err.name = payload.name != null ? String(payload.name) : 'Error';
  if (typeof payload.stack === 'string') {
    err.stack = payload.stack;
  }
  if (payload.cause !== undefined) {
    (err as Error & { cause?: unknown }).cause = deserializeError(
      payload.cause
    );
  }
  if (payload.data !== undefined) {
    (err as Error & { data?: unknown }).data = payload.data;
  }
  return err;
}

function isCodeSessionSnapshotEntry(
  value: unknown
): value is AxCodeSessionSnapshotEntry {
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

export function normalizeCodeSessionSnapshot(
  value: unknown
): AxCodeSessionSnapshot {
  if (!value || typeof value !== 'object') {
    return { version: 1, entries: [], bindings: {} };
  }

  const candidate = value as Record<string, unknown>;
  const rawEntries = Array.isArray(candidate.entries) ? candidate.entries : [];
  const bindings =
    candidate.bindings && typeof candidate.bindings === 'object'
      ? (candidate.bindings as Record<string, unknown>)
      : {};

  return {
    version: 1,
    entries: rawEntries.filter(isCodeSessionSnapshotEntry),
    bindings,
  };
}
