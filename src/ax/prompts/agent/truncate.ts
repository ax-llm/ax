/** Minimum characters for runtime output — outputs never shrink below this. */
export const MIN_RUNTIME_CHARS = 400;

/** Floor ratio for budget-proportional decay (15% of maxRuntimeChars). */
export const RUNTIME_BUDGET_FLOOR_RATIO = 0.15;

/** Array length threshold above which smart truncation kicks in. */
const ARRAY_TRUNCATION_THRESHOLD = 10;
/** Number of array items to keep from the start. */
const ARRAY_HEAD_ITEMS = 3;
/** Number of array items to keep from the end. */
const ARRAY_TAIL_ITEMS = 2;

/** Maximum object nesting depth before values are replaced with placeholders. */
const MAX_OBJECT_DEPTH = 3;

/** Stack frames to keep from the top of a stack trace. */
const STACK_HEAD_FRAMES = 3;
/** Stack frames to keep from the bottom of a stack trace. */
const STACK_TAIL_FRAMES = 1;

/**
 * Compute a dynamic runtime char limit that scales with remaining context budget.
 *
 * Early turns (empty log) get the full `maxRuntimeChars`. As the action log
 * fills toward `targetPromptChars`, the limit decays linearly down to
 * `floor(maxRuntimeChars * floorRatio)`, hard-floored at `minRuntimeChars`.
 */
export function computeDynamicRuntimeChars(
  actionLogEntries: readonly { code: string; output: string }[],
  targetPromptChars: number,
  maxRuntimeChars: number,
  minRuntimeChars = MIN_RUNTIME_CHARS,
  floorRatio = RUNTIME_BUDGET_FLOOR_RATIO
): number {
  const currentChars = actionLogEntries.reduce(
    (sum, e) => sum + e.code.length + e.output.length,
    0
  );
  const usageRatio =
    targetPromptChars > 0 ? currentChars / targetPromptChars : 0;
  const remainingRatio = Math.max(floorRatio, Math.min(1, 1 - usageRatio));
  const effectiveMin = Math.min(minRuntimeChars, maxRuntimeChars);
  return Math.max(
    effectiveMin,
    Math.min(maxRuntimeChars, Math.floor(maxRuntimeChars * remainingRatio))
  );
}

/**
 * Type-aware serialization that preserves structural information within a
 * char budget. Runs *before* the final `truncateText` pass.
 *
 * - Large arrays: keeps head/tail items with a hidden-count placeholder.
 * - Deep objects: replaces nested values beyond depth 3 with `[Object]`/`[Array(N)]`.
 * - Error-like values with `.stack`: compresses middle stack frames.
 * - Everything else: standard `JSON.stringify`.
 */
export function smartStringify(value: unknown, maxChars: number): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  // Error-like objects with a stack trace
  if (isErrorLike(value)) {
    return stringifyErrorWithStack(value);
  }

  // Arrays
  if (Array.isArray(value)) {
    return stringifyArray(value, maxChars);
  }

  // Plain objects — use depth-limited serialization
  if (typeof value === 'object') {
    return depthLimitedStringify(value, MAX_OBJECT_DEPTH);
  }

  return JSON.stringify(value, null, 2);
}

/**
 * Compress stack traces: keep first N and last M frames, elide the middle.
 */
export function truncateStackTrace(stack: string): string {
  const lines = stack.split('\n');

  // Find where stack frames start (lines starting with whitespace + "at ")
  const frameStart = lines.findIndex((l) => /^\s+at\s/.test(l));
  if (frameStart < 0) return stack;

  const preamble = lines.slice(0, frameStart);
  const frames = lines.slice(frameStart);

  const totalKeep = STACK_HEAD_FRAMES + STACK_TAIL_FRAMES;
  if (frames.length <= totalKeep) return stack;

  const head = frames.slice(0, STACK_HEAD_FRAMES);
  const tail = frames.slice(-STACK_TAIL_FRAMES);
  const hidden = frames.length - totalKeep;

  return [
    ...preamble,
    ...head,
    `    ... [${hidden} frames hidden]`,
    ...tail,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isErrorLike(
  value: unknown
): value is { name?: string; message?: string; stack?: string } {
  if (!value || typeof value !== 'object') return false;
  return (
    'stack' in value && typeof (value as { stack: unknown }).stack === 'string'
  );
}

function stringifyErrorWithStack(err: {
  name?: string;
  message?: string;
  stack?: string;
}): string {
  const stack = err.stack;
  if (!stack) {
    return JSON.stringify(err, null, 2);
  }
  return truncateStackTrace(stack);
}

function stringifyArray(arr: unknown[], maxChars: number): string {
  if (arr.length <= ARRAY_TRUNCATION_THRESHOLD) {
    return depthLimitedStringify(arr, MAX_OBJECT_DEPTH);
  }

  const perItemBudget = Math.max(
    80,
    Math.floor(maxChars / (ARRAY_HEAD_ITEMS + ARRAY_TAIL_ITEMS + 1))
  );

  const head = arr.slice(0, ARRAY_HEAD_ITEMS).map((item) => {
    const s = safeStringify(item);
    return s.length > perItemBudget ? `${s.slice(0, perItemBudget - 3)}...` : s;
  });

  const tail = arr.slice(-ARRAY_TAIL_ITEMS).map((item) => {
    const s = safeStringify(item);
    return s.length > perItemBudget ? `${s.slice(0, perItemBudget - 3)}...` : s;
  });

  const hidden = arr.length - ARRAY_HEAD_ITEMS - ARRAY_TAIL_ITEMS;
  return `[\n  ${head.join(',\n  ')},\n  ... [${hidden} hidden items],\n  ${tail.join(',\n  ')}\n]`;
}

function depthLimitedStringify(value: unknown, maxDepth: number): string {
  const seen = new WeakSet<object>();

  const replacer = (depth: number) => {
    return (_key: string, val: unknown): unknown => {
      if (val === null || typeof val !== 'object') {
        return val;
      }

      // Circular reference guard
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);

      if (depth >= maxDepth) {
        if (Array.isArray(val)) {
          return `[Array(${val.length})]`;
        }
        return '[Object]';
      }

      // Recursively process with incremented depth
      if (Array.isArray(val)) {
        return val.map((item, i) => {
          const inner = replacer(depth + 1)(String(i), item);
          return inner;
        });
      }

      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        result[k] = replacer(depth + 1)(k, v);
      }
      return result;
    };
  };

  try {
    // Process value through depth limiter, then stringify
    const processed = replacer(0)('', value);
    return JSON.stringify(processed, null, 2);
  } catch {
    return String(value);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
