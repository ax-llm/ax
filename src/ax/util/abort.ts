/**
 * Merges two AbortSignals into a single signal that aborts when either input aborts.
 * Returns undefined if both inputs are undefined.
 * Returns the single defined signal if only one is provided.
 * Uses AbortSignal.any() when available (Node 20+), with a manual fallback.
 */
export function mergeAbortSignals(
  a?: AbortSignal,
  b?: AbortSignal
): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;

  // Already aborted — return immediately
  if (a.aborted) return a;
  if (b.aborted) return b;

  // Use native AbortSignal.any() when available
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([a, b]);
  }

  // Fallback: manual merge via a new AbortController
  const controller = new AbortController();

  const onAbort = () => {
    controller.abort(a.aborted ? a.reason : b.reason);
    cleanup();
  };

  const cleanup = () => {
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
  };

  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });

  return controller.signal;
}
