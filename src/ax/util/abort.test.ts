import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';

import { mergeAbortSignals } from './abort.js';

describe('mergeAbortSignals', () => {
  it.each([0, 1])(
    'cleans up both fallback listeners when signal %i aborts first',
    (first) => {
      const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
      Object.defineProperty(AbortSignal, 'any', {
        configurable: true,
        value: undefined,
      });

      try {
        const controllers = [new AbortController(), new AbortController()];
        const merged = mergeAbortSignals(
          controllers[0].signal,
          controllers[1].signal
        )!;
        const reason = new Error('first abort');

        expect(merged.aborted).toBe(false);
        for (const controller of controllers) {
          expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
        }

        controllers[first].abort(reason);

        expect(merged.aborted).toBe(true);
        expect(merged.reason).toBe(reason);
        for (const controller of controllers) {
          expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
        }

        controllers[1 - first].abort(new Error('second abort'));
        expect(merged.reason).toBe(reason);
      } finally {
        if (descriptor) {
          Object.defineProperty(AbortSignal, 'any', descriptor);
        } else {
          Reflect.deleteProperty(AbortSignal, 'any');
        }
      }
    }
  );

  it('returns undefined when both signals are undefined', () => {
    expect(mergeAbortSignals(undefined, undefined)).toBeUndefined();
  });

  it('returns the single signal when only one is provided', () => {
    const controller = new AbortController();
    expect(mergeAbortSignals(controller.signal, undefined)).toBe(
      controller.signal
    );
    expect(mergeAbortSignals(undefined, controller.signal)).toBe(
      controller.signal
    );
  });

  it('returns the same signal when both are the same instance', () => {
    const controller = new AbortController();
    expect(mergeAbortSignals(controller.signal, controller.signal)).toBe(
      controller.signal
    );
  });

  it('returns an already-aborted signal if a is aborted', () => {
    const a = AbortSignal.abort('reason-a');
    const b = new AbortController().signal;
    const merged = mergeAbortSignals(a, b);
    expect(merged?.aborted).toBe(true);
  });

  it('returns an already-aborted signal if b is aborted', () => {
    const a = new AbortController().signal;
    const b = AbortSignal.abort('reason-b');
    const merged = mergeAbortSignals(a, b);
    expect(merged?.aborted).toBe(true);
  });

  it('aborts merged signal when first signal aborts', async () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const merged = mergeAbortSignals(controllerA.signal, controllerB.signal)!;

    expect(merged.aborted).toBe(false);

    controllerA.abort('stopped');

    // Give the event listener a tick to propagate
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(merged.aborted).toBe(true);
  });

  it('aborts merged signal when second signal aborts', async () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const merged = mergeAbortSignals(controllerA.signal, controllerB.signal)!;

    expect(merged.aborted).toBe(false);

    controllerB.abort('stopped');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(merged.aborted).toBe(true);
  });
});
