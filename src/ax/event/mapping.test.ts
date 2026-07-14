import { describe, expect, it, vi } from 'vitest';
import { AxSignature } from '../dsp/sig.js';
import type { AxProgrammable } from '../dsp/types.js';
import { eventInput, eventPath } from './mapping.js';
import { AxInMemoryEventStore } from './memoryStore.js';
import { AxEventRuntime, eventRoute, eventTarget } from './runtime.js';
import type { AxEventIngress } from './types.js';

const ai = {} as any;

function program<IN, OUT>(
  signature: string,
  forward: (input: IN) => OUT | Promise<OUT>
): AxProgrammable<IN, OUT> {
  const value = new AxSignature(signature);
  return {
    getId: () => 'mapped-program',
    getSignature: () => value,
    forward: (_ai: unknown, input: IN) => Promise.resolve(forward(input)),
    streamingForward: async function* () {},
  } as unknown as AxProgrammable<IN, OUT>;
}

function ingress(
  id: string,
  type: string,
  data: Record<string, unknown>
): AxEventIngress {
  return {
    event: {
      specversion: '1.0',
      id,
      source: 'app://mapping-tests',
      type,
      subject: 'account-1',
      data: data as never,
    },
    identity: { tenantId: 'tenant-1', accountId: 'account-1' },
    trust: 'authenticated',
  };
}

describe('fluent event mapping', () => {
  it('projects signature fields, applies explicit overrides, and ignores extras', async () => {
    const forward = vi.fn((input) => ({ seen: input }));
    const target = eventTarget('projected')
      .program(
        program<
          { url: string; revision: number; tenant?: string },
          { seen: unknown }
        >('url:string, revision:number, tenant?:string -> seen:json', forward)
      )
      .ai(ai)
      .input((input) =>
        input
          .project(eventPath.data('document'))
          .field('url', eventPath.data('canonicalUrl'))
          .field('tenant', eventPath.identity('tenantId'))
      )
      .build();
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute('project')
          .types('document.changed')
          .authenticated()
          .instanceKey(eventPath.subject())
          .wake(target)
          .build(),
      ],
    });
    await runtime.start();
    await runtime.publish(
      ingress('project-1', 'document.changed', {
        canonicalUrl: 'https://example.com/canonical',
        document: {
          url: 'https://example.com/ignored',
          revision: 7,
          extra: 'not forwarded',
        },
      })
    );
    await runtime.waitForIdle();
    expect(forward).toHaveBeenCalledWith({
      url: 'https://example.com/canonical',
      revision: 7,
      tenant: 'tenant-1',
    });
    await runtime.close();
  });

  it('uses action-specific mappings and declaratively resumes a continuation', async () => {
    const calls: unknown[] = [];
    const target = eventTarget('continuable')
      .program(
        program<{ url: string; revision: number }, { ok: boolean }>(
          'url:string, revision:number -> ok:boolean',
          (input) => {
            calls.push(input);
            return { ok: true };
          }
        )
      )
      .ai(ai)
      .wakeInput((input) => input.project(eventPath.data()))
      .resumeInput((input) =>
        input
          .field('url', eventPath.continuation('url'))
          .field('revision', eventPath.data('revision'))
      )
      .waitFor('job', eventPath.data('jobId'), {
        metadata: { url: eventPath.data('url') },
      })
      .retrySafety('idempotent')
      .build();
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute('start').types('job.started').wake(target).build(),
        eventRoute('resume')
          .types('job.completed')
          .correlate('job', eventPath.data('jobId'))
          .resume(target)
          .build(),
      ],
    });
    await runtime.start();
    await runtime.publish(
      ingress('start-1', 'job.started', {
        jobId: 'job-42',
        url: 'https://example.com/job',
        revision: 1,
      })
    );
    await runtime.waitForIdle();
    await runtime.publish(
      ingress('finish-1', 'job.completed', {
        jobId: 'job-42',
        revision: 2,
      })
    );
    await runtime.waitForIdle();
    expect(calls).toEqual([
      { url: 'https://example.com/job', revision: 1 },
      { url: 'https://example.com/job', revision: 2 },
    ]);
    await runtime.close();
  });

  it('dead-letters invalid mapped input without invoking or retrying the model', async () => {
    const store = new AxInMemoryEventStore();
    const forward = vi.fn(() => ({ ok: true }));
    const target = eventTarget('invalid')
      .program(
        program<{ revision: number }, { ok: boolean }>(
          'revision:number -> ok:boolean',
          forward
        )
      )
      .ai(ai)
      .input((input) => input.field('revision', eventPath.data('revision')))
      .build();
    const runtime = new AxEventRuntime({
      store,
      maxAttempts: 5,
      routes: [eventRoute('invalid').types('invalid').wake(target).build()],
    });
    await runtime.start();
    const receipt = await runtime.publish(
      ingress('invalid-1', 'invalid', { revision: 'not-a-number' })
    );
    await runtime.waitForIdle();
    expect(forward).not.toHaveBeenCalled();
    const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
    expect(delivery?.status).toBe('dead_lettered');
    expect(delivery?.attempt).toBe(1);
    expect(delivery?.invocationStarted).not.toBe(true);
    expect((await runtime.listDeadLetters())[0]?.reason).toContain(
      'event_input_invalid'
    );
    await runtime.close();
  });

  it('normalizes callback mapping through the program signature', async () => {
    const forward = vi.fn(() => ({ ok: true }));
    const target = eventTarget({
      id: 'callback-normalized',
      ai,
      program: program<
        { url: string; revision: number; note?: string },
        { ok: boolean }
      >('url:string, revision:number, note?:string -> ok:boolean', forward),
      mapInput: () => ({
        url: 'https://example.com/callback',
        revision: 3,
        extra: 'discarded',
      }),
    });
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute({
          id: 'callback-normalized',
          match: { types: ['callback.valid'] },
          action: 'wake',
          target,
        }),
      ],
    });
    await runtime.start();
    await runtime.publish(ingress('callback-valid', 'callback.valid', {}));
    await runtime.waitForIdle();
    expect(forward).toHaveBeenCalledWith({
      url: 'https://example.com/callback',
      revision: 3,
    });
    await runtime.close();
  });

  it.each([
    ['missing required field', () => ({ revision: 1 })],
    [
      'invalid field type',
      () => ({ url: 'https://example.com', revision: 'bad' }),
    ],
    ['non-object result', () => 'bad'],
    [
      'synchronous mapper failure',
      () => {
        throw new Error('sync mapper failed');
      },
    ],
    [
      'asynchronous mapper failure',
      async () => {
        throw new Error('async mapper failed');
      },
    ],
  ])(
    'dead-letters callback mapping with %s before invocation',
    async (_label, mapInput) => {
      const store = new AxInMemoryEventStore();
      const forward = vi.fn(() => ({ ok: true }));
      const target = eventTarget({
        id: 'callback-invalid',
        ai,
        program: program<{ url: string; revision: number }, { ok: boolean }>(
          'url:string, revision:number -> ok:boolean',
          forward
        ),
        mapInput: mapInput as never,
        retrySafety: 'idempotent',
      });
      const runtime = new AxEventRuntime({
        store,
        maxAttempts: 5,
        routes: [
          eventRoute({
            id: 'callback-invalid',
            match: { types: ['callback.invalid'] },
            action: 'wake',
            target,
          }),
        ],
      });
      await runtime.start();
      const receipt = await runtime.publish(
        ingress('callback-invalid', 'callback.invalid', {})
      );
      await runtime.waitForIdle();
      expect(forward).not.toHaveBeenCalled();
      const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
      expect(delivery).toMatchObject({
        status: 'dead_lettered',
        attempt: 1,
      });
      expect(delivery?.invocationStarted).not.toBe(true);
      expect(await runtime.listDeadLetters()).toHaveLength(1);
      expect((await runtime.listDeadLetters())[0]?.reason).toContain(
        'event_input_invalid'
      );
      await runtime.close();
    }
  );

  it('validates callback mapping against each factory-created program', async () => {
    const store = new AxInMemoryEventStore();
    const forward = vi.fn(() => ({ ok: true }));
    const signature = new AxSignature('payloadText:string -> ok:boolean');
    const target = eventTarget({
      id: 'callback-factory',
      ai,
      inputSignature: signature,
      createProgram: () => program('payloadText:string -> ok:boolean', forward),
      mapInput: () => ({ payloadText: 42 }),
      retrySafety: 'idempotent',
    });
    const runtime = new AxEventRuntime({
      store,
      routes: [
        eventRoute({
          id: 'callback-factory',
          match: { types: ['callback.factory'] },
          action: 'wake',
          target,
        }),
      ],
    });
    await runtime.start();
    await runtime.publish(ingress('callback-factory', 'callback.factory', {}));
    await runtime.waitForIdle();
    expect(forward).not.toHaveBeenCalled();
    expect(await runtime.listDeadLetters()).toHaveLength(1);
    await runtime.close();
  });

  it('fans one ingress out to independent one-target routes', async () => {
    const first = vi.fn(() => ({ ok: true }));
    const second = vi.fn(() => ({ ok: true }));
    const makeTarget = (id: string, forward: typeof first) =>
      eventTarget(id)
        .program(
          program<{ message: string }, { ok: boolean }>(
            'message:string -> ok:boolean',
            forward
          )
        )
        .ai(ai)
        .input(eventInput<{ message: string }>().project(eventPath.data()))
        .build();
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute('first')
          .types('fanout')
          .wake(makeTarget('a', first))
          .build(),
        eventRoute('second')
          .types('fanout')
          .wake(makeTarget('b', second))
          .build(),
      ],
    });
    await runtime.start();
    const receipt = await runtime.publish(
      ingress('fanout-1', 'fanout', { message: 'shared' })
    );
    await runtime.waitForIdle();
    expect(receipt.deliveryIds).toHaveLength(2);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it('requires a declared signature for factory-backed declarative mapping', () => {
    expect(() =>
      eventTarget({
        id: 'factory',
        ai,
        createProgram: () =>
          program<{ value: string }, { ok: boolean }>(
            'value:string -> ok:boolean',
            () => ({ ok: true })
          ),
        input: eventInput<{ value: string }>()
          .project(eventPath.data())
          .build(),
      })
    ).toThrow('requires inputSignature');
  });

  it('rejects unsafe path segments and duplicate explicit destinations', () => {
    expect(() => eventPath.data('__proto__')).toThrow(
      'Unsafe event path segment'
    );
    expect(() => eventPath.data('constructor')).toThrow(
      'Unsafe event path segment'
    );
    expect(() =>
      eventInput<{ value: string }>()
        .field('value', eventPath.data('first'))
        .field('value', eventPath.data('second'))
    ).toThrow('mapped more than once');
  });

  it('does not let resume routes fall back to wake-only mappings', () => {
    const target = eventTarget('wake-only')
      .program(
        program<{ message: string }, { ok: boolean }>(
          'message:string -> ok:boolean',
          () => ({ ok: true })
        )
      )
      .ai(ai)
      .wakeInput((input) => input.field('message', eventPath.data('message')))
      .build();
    expect(() =>
      eventRoute('resume-with-wake-input')
        .types('resume')
        .resume(target)
        .build()
    ).toThrow('requires input or resumeInput');
  });

  it('dead-letters a factory whose program signature differs from its declaration', async () => {
    const store = new AxInMemoryEventStore();
    const forward = vi.fn(() => ({ ok: true }));
    const target = eventTarget('factory-mismatch')
      .createProgram(new AxSignature('message:string -> ok:boolean'), () =>
        program('other:string -> ok:boolean', forward)
      )
      .ai(ai)
      .input((input) => input.field('message', eventPath.data('message')))
      .build();
    const runtime = new AxEventRuntime({
      store,
      routes: [
        eventRoute('factory-mismatch')
          .types('factory.mismatch')
          .wake(target)
          .build(),
      ],
    });
    await runtime.start();
    const receipt = await runtime.publish(
      ingress('factory-1', 'factory.mismatch', { message: 'hello' })
    );
    await runtime.waitForIdle();
    const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
    expect(delivery?.status).toBe('dead_lettered');
    expect(delivery?.invocationStarted).not.toBe(true);
    expect(forward).not.toHaveBeenCalled();
    expect((await runtime.listDeadLetters())[0]?.reason).toContain(
      'Created program signature does not match'
    );
    await runtime.close();
  });
});
