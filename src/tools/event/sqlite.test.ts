import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AxEventRuntime,
  AxManualEventClock,
  type AxProgrammable,
  eventRoute,
  eventTarget,
  runAxEventStoreConformance,
} from '@ax-llm/ax';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AX_SQLITE_EVENT_STANDARD_RETENTION,
  AxSQLiteEventStore,
} from './sqlite.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AxSQLiteEventStore', () => {
  it('passes the persistent multi-worker conformance kit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-event-sqlite-'));
    directories.push(directory);
    const clock = new AxManualEventClock(10_000);
    const report = await runAxEventStoreConformance(
      ({ databaseKey, maxPendingDeliveries }) => {
        const store = new AxSQLiteEventStore({
          filename: join(directory, `${databaseKey}.sqlite`),
          clock,
          retention: AX_SQLITE_EVENT_STANDARD_RETENTION,
          maxPendingDeliveries,
        });
        return { store, stateStore: store };
      },
      { clock }
    );
    expect(report.assertions).toBeGreaterThanOrEqual(20);
    expect(report.capability.conformance?.multiWorker).toBe('axevent-store-v1');
  });

  it('requires explicit retention and WAL-enabled local storage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-event-sqlite-'));
    directories.push(directory);
    expect(
      () =>
        new AxSQLiteEventStore({
          filename: join(directory, 'missing-retention.sqlite'),
        } as never)
    ).toThrow('requires explicit retention');
  });

  it('records oversized output failure without dispatching sinks or rerunning', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-event-sqlite-'));
    directories.push(directory);
    const store = new AxSQLiteEventStore({
      filename: join(directory, 'runtime.sqlite'),
      retention: AX_SQLITE_EVENT_STANDARD_RETENTION,
      maxInlinePayloadBytes: 512,
    });
    let calls = 0;
    let sinkCalls = 0;
    const program = {
      getId: () => 'large-output',
      forward: async () => {
        calls++;
        return { value: 'x'.repeat(2_000) };
      },
      streamingForward: async function* () {},
    } as unknown as AxProgrammable<any, any>;
    const runtime = new AxEventRuntime({
      store,
      programStateStore: store,
      coordination: 'multi-worker',
      routes: [
        eventRoute({
          id: 'large-output-route',
          match: { types: ['large.output'] },
          action: 'wake',
          target: eventTarget({
            id: 'large-output-target',
            ai: {} as never,
            program,
            mapInput: () => ({}),
            retrySafety: 'idempotent',
            sinks: [
              {
                id: 'must-not-run',
                write: () => {
                  sinkCalls++;
                },
              },
            ],
          }),
        }),
      ],
    });
    await runtime.start();
    const receipt = await runtime.publish({
      event: {
        specversion: '1.0',
        id: 'large-1',
        source: 'test://sqlite',
        type: 'large.output',
      },
      trust: 'trusted',
    });
    await runtime.waitForIdle();
    const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
    expect(delivery?.status).toBe('output_persistence_failed');
    expect(calls).toBe(1);
    expect(sinkCalls).toBe(0);
    await runtime.close({ drain: false });
  });

  it('persists output before isolated sink retries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-event-sqlite-'));
    directories.push(directory);
    const store = new AxSQLiteEventStore({
      filename: join(directory, 'sink.sqlite'),
      retention: AX_SQLITE_EVENT_STANDARD_RETENTION,
    });
    let modelCalls = 0;
    let sinkCalls = 0;
    const program = {
      getId: () => 'sink-output',
      forward: async () => {
        modelCalls++;
        return { persisted: true };
      },
      streamingForward: async function* () {},
    } as unknown as AxProgrammable<any, any>;
    const runtime = new AxEventRuntime({
      store,
      programStateStore: store,
      coordination: 'multi-worker',
      maxAttempts: 2,
      retryBaseMs: 1,
      retryMaxMs: 1,
      routes: [
        eventRoute({
          id: 'sink-route',
          match: { types: ['sink.test'] },
          action: 'wake',
          target: eventTarget({
            id: 'sink-target',
            ai: {} as never,
            program,
            mapInput: () => ({}),
            retrySafety: 'idempotent',
            sinks: [
              {
                id: 'failing-sink',
                write: async (_output, context) => {
                  sinkCalls++;
                  expect((await store.getRun(context.run.id))?.output).toEqual({
                    persisted: true,
                  });
                  throw new Error('sink unavailable');
                },
              },
            ],
          }),
        }),
      ],
    });
    await runtime.start();
    await runtime.publish({
      event: {
        specversion: '1.0',
        id: 'sink-1',
        source: 'test://sqlite',
        type: 'sink.test',
      },
      trust: 'trusted',
    });
    await runtime.waitForIdle();
    expect(modelCalls).toBe(1);
    expect(sinkCalls).toBe(2);
    expect(await runtime.listDeadLetters()).toEqual([
      expect.objectContaining({ kind: 'sink', sinkId: 'failing-sink' }),
    ]);
    await runtime.close({ drain: false });
  });
});
