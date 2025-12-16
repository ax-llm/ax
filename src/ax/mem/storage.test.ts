import { describe, it, expect, beforeEach } from 'vitest';
import type { AxTrace, AxCheckpoint } from './storage.js';
import { AxMemoryStorage } from './storage.js';

describe('AxMemoryStorage', () => {
  let storage: AxMemoryStorage;

  beforeEach(() => {
    storage = new AxMemoryStorage();
  });

  describe('Trace Operations', () => {
    const createTrace = (overrides: Partial<AxTrace> = {}): AxTrace => ({
      id: `trace-${Date.now()}-${Math.random()}`,
      agentId: 'test-agent',
      input: { query: 'test input' },
      output: { response: 'test output' },
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 100,
      ...overrides,
    });

    it('should save and retrieve traces', async () => {
      const trace = createTrace();
      await storage.saveTrace(trace);

      const traces = await storage.getTraces('test-agent');
      expect(traces).toHaveLength(1);
      expect(traces[0]).toEqual(trace);
    });

    it('should filter traces by agentId', async () => {
      await storage.saveTrace(createTrace({ agentId: 'agent-1' }));
      await storage.saveTrace(createTrace({ agentId: 'agent-2' }));
      await storage.saveTrace(createTrace({ agentId: 'agent-1' }));

      const agent1Traces = await storage.getTraces('agent-1');
      const agent2Traces = await storage.getTraces('agent-2');

      expect(agent1Traces).toHaveLength(2);
      expect(agent2Traces).toHaveLength(1);
    });

    it('should filter traces by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await storage.saveTrace(createTrace({ startTime: yesterday }));
      await storage.saveTrace(createTrace({ startTime: now }));
      await storage.saveTrace(createTrace({ startTime: tomorrow }));

      const sinceNow = await storage.getTraces('test-agent', { since: now });
      expect(sinceNow).toHaveLength(2); // now and tomorrow

      const untilNow = await storage.getTraces('test-agent', { until: now });
      expect(untilNow).toHaveLength(2); // yesterday and now
    });

    it('should filter traces by feedback presence', async () => {
      await storage.saveTrace(createTrace());
      await storage.saveTrace(createTrace({ feedback: { score: 0.8 } }));

      const withFeedback = await storage.getTraces('test-agent', {
        hasFeedback: true,
      });
      const withoutFeedback = await storage.getTraces('test-agent', {
        hasFeedback: false,
      });

      expect(withFeedback).toHaveLength(1);
      expect(withoutFeedback).toHaveLength(1);
    });

    it('should filter traces by error presence', async () => {
      await storage.saveTrace(createTrace());
      await storage.saveTrace(createTrace({ error: 'Something went wrong' }));

      const withError = await storage.getTraces('test-agent', {
        hasError: true,
      });
      const withoutError = await storage.getTraces('test-agent', {
        hasError: false,
      });

      expect(withError).toHaveLength(1);
      expect(withoutError).toHaveLength(1);
    });

    it('should paginate traces', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.saveTrace(
          createTrace({
            id: `trace-${i}`,
            startTime: new Date(Date.now() - i * 1000), // Older traces have higher index
          })
        );
      }

      const page1 = await storage.getTraces('test-agent', {
        limit: 3,
        offset: 0,
      });
      const page2 = await storage.getTraces('test-agent', {
        limit: 3,
        offset: 3,
      });

      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);
      // Most recent first
      expect(page1[0]?.id).toBe('trace-0');
      expect(page2[0]?.id).toBe('trace-3');
    });

    it('should count traces', async () => {
      expect(await storage.getTraceCount('test-agent')).toBe(0);

      await storage.saveTrace(createTrace());
      await storage.saveTrace(createTrace());

      expect(await storage.getTraceCount('test-agent')).toBe(2);
    });

    it('should delete specific traces', async () => {
      await storage.saveTrace(createTrace({ id: 'trace-1' }));
      await storage.saveTrace(createTrace({ id: 'trace-2' }));
      await storage.saveTrace(createTrace({ id: 'trace-3' }));

      await storage.deleteTraces('test-agent', ['trace-1', 'trace-3']);

      const traces = await storage.getTraces('test-agent');
      expect(traces).toHaveLength(1);
      expect(traces[0]?.id).toBe('trace-2');
    });

    it('should delete all traces for an agent', async () => {
      await storage.saveTrace(createTrace());
      await storage.saveTrace(createTrace());

      await storage.deleteTraces('test-agent');

      const traces = await storage.getTraces('test-agent');
      expect(traces).toHaveLength(0);
    });

    it('should add feedback to a trace', async () => {
      await storage.saveTrace(createTrace({ id: 'trace-1' }));

      await storage.addFeedback('trace-1', {
        score: 0.9,
        label: 'good',
        comment: 'Great response!',
      });

      const traces = await storage.getTraces('test-agent');
      expect(traces[0]?.feedback).toEqual({
        score: 0.9,
        label: 'good',
        comment: 'Great response!',
      });
    });
  });

  describe('Checkpoint Operations', () => {
    const createCheckpoint = (
      overrides: Partial<AxCheckpoint> = {}
    ): AxCheckpoint => ({
      agentId: 'test-agent',
      version: 1,
      createdAt: new Date(),
      instruction: 'Test instruction',
      ...overrides,
    });

    it('should save and load checkpoints', async () => {
      const checkpoint = createCheckpoint();
      await storage.saveCheckpoint(checkpoint);

      const loaded = await storage.loadCheckpoint('test-agent');
      expect(loaded).toEqual(checkpoint);
    });

    it('should load the latest checkpoint', async () => {
      await storage.saveCheckpoint(createCheckpoint({ version: 1 }));
      await storage.saveCheckpoint(
        createCheckpoint({ version: 3, instruction: 'Latest' })
      );
      await storage.saveCheckpoint(createCheckpoint({ version: 2 }));

      const latest = await storage.loadCheckpoint('test-agent');
      expect(latest?.version).toBe(3);
      expect(latest?.instruction).toBe('Latest');
    });

    it('should load a specific checkpoint version', async () => {
      await storage.saveCheckpoint(
        createCheckpoint({ version: 1, instruction: 'v1' })
      );
      await storage.saveCheckpoint(
        createCheckpoint({ version: 2, instruction: 'v2' })
      );

      const v1 = await storage.loadCheckpointVersion('test-agent', 1);
      expect(v1?.instruction).toBe('v1');
    });

    it('should return null for non-existent checkpoint', async () => {
      const loaded = await storage.loadCheckpoint('non-existent');
      expect(loaded).toBeNull();
    });

    it('should list all checkpoints', async () => {
      await storage.saveCheckpoint(createCheckpoint({ version: 1 }));
      await storage.saveCheckpoint(createCheckpoint({ version: 2 }));
      await storage.saveCheckpoint(createCheckpoint({ version: 3 }));

      const checkpoints = await storage.listCheckpoints('test-agent');
      expect(checkpoints).toHaveLength(3);
      // Should be sorted by version descending
      expect(checkpoints.map((c) => c.version)).toEqual([3, 2, 1]);
    });

    it('should update existing checkpoint version', async () => {
      await storage.saveCheckpoint(
        createCheckpoint({ version: 1, instruction: 'Original' })
      );
      await storage.saveCheckpoint(
        createCheckpoint({ version: 1, instruction: 'Updated' })
      );

      const checkpoints = await storage.listCheckpoints('test-agent');
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.instruction).toBe('Updated');
    });

    it('should delete a specific checkpoint version', async () => {
      await storage.saveCheckpoint(createCheckpoint({ version: 1 }));
      await storage.saveCheckpoint(createCheckpoint({ version: 2 }));

      await storage.deleteCheckpoint('test-agent', 1);

      const checkpoints = await storage.listCheckpoints('test-agent');
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.version).toBe(2);
    });

    it('should delete all checkpoints for an agent', async () => {
      await storage.saveCheckpoint(createCheckpoint({ version: 1 }));
      await storage.saveCheckpoint(createCheckpoint({ version: 2 }));

      await storage.deleteCheckpoint('test-agent');

      const checkpoints = await storage.listCheckpoints('test-agent');
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe('Clear Operations', () => {
    it('should clear all data for an agent', async () => {
      await storage.saveTrace({
        id: 'trace-1',
        agentId: 'test-agent',
        input: {},
        output: {},
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 100,
      });
      await storage.saveCheckpoint({
        agentId: 'test-agent',
        version: 1,
        createdAt: new Date(),
      });

      await storage.clear('test-agent');

      expect(await storage.getTraces('test-agent')).toHaveLength(0);
      expect(await storage.loadCheckpoint('test-agent')).toBeNull();
    });

    it('should clear all data globally', async () => {
      await storage.saveTrace({
        id: 'trace-1',
        agentId: 'agent-1',
        input: {},
        output: {},
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 100,
      });
      await storage.saveTrace({
        id: 'trace-2',
        agentId: 'agent-2',
        input: {},
        output: {},
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 100,
      });

      await storage.clearAll();

      expect(await storage.getTraces('agent-1')).toHaveLength(0);
      expect(await storage.getTraces('agent-2')).toHaveLength(0);
    });
  });
});
