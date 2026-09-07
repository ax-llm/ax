import { getEventListeners } from 'node:events';

import { describe, expect, it } from 'vitest';

import { AxManualEventClock, AxSystemEventClock } from './types.js';

describe('AxSystemEventClock.sleep', () => {
  it('removes the abort listener after each timer-resolved sleep', async () => {
    const clock = new AxSystemEventClock();
    const controller = new AbortController();
    const { signal } = controller;

    for (let i = 0; i < 25; i++) {
      await clock.sleep(0, signal);
    }

    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });

  it('still rejects and cleans up when the signal aborts', async () => {
    const clock = new AxSystemEventClock();
    const controller = new AbortController();
    const { signal } = controller;
    const reason = new Error('aborted');

    const pending = clock.sleep(1000, signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });
});

describe('AxManualEventClock.sleep', () => {
  it('removes the abort listener after each advance-resolved sleep', async () => {
    const clock = new AxManualEventClock();
    const controller = new AbortController();
    const { signal } = controller;

    for (let i = 0; i < 25; i++) {
      const pending = clock.sleep(5, signal);
      clock.advanceBy(5);
      await pending;
    }

    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });

  it('still rejects and cleans up when the signal aborts', async () => {
    const clock = new AxManualEventClock();
    const controller = new AbortController();
    const { signal } = controller;
    const reason = new Error('aborted');

    const pending = clock.sleep(5, signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });
});
