import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { f, fn } from '../dsp/sig.js';
import {
  buildExecutionHelpers,
  type ExecutionHelperDeps,
} from './agentInternal/runtimeExecutionHelpers.js';
import { wrapFunction } from './agentInternal/runtimeGlobals.js';
import { TurnObservations } from './agentInternal/turnObservations.js';
import { agent } from './index.js';
import type { AxCodeSession } from './rlm.js';

it.each([undefined, 'checkpointed', 'lean'] as const)(
  'observes a bare awaited tool result without a logging correction under %s context',
  async (preset) => {
    const calls: string[] = [];
    let executorTurns = 0;
    const model = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async ({ chatPrompt }) => {
        const system = String(chatPrompt[0]?.content ?? '');
        const prompt = String(chatPrompt[1]?.content ?? '');
        let content: string;
        if (system.includes('You (`distiller`)')) {
          content =
            'Javascript Code: await final("Apply the account update", {})';
        } else if (system.includes('You (`executor`)')) {
          executorTurns++;
          if (executorTurns === 1) {
            content =
              'Javascript Code: const account = await accounts.read({});';
          } else {
            expect(executorTurns).toBe(2);
            expect(prompt).toContain('Use the replacement account new-account');
            expect(prompt).not.toContain('[POLICY]');
            content = `Javascript Code: const updated = await accounts.update({ id: 'new-account', revision: account.revision }); await final('Report the update', { updated });`;
          }
        } else {
          content = 'Answer: Updated the replacement account.';
        }
        return {
          results: [{ index: 0, content, finishReason: 'stop' }],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        };
      },
    });
    const read = fn('read')
      .namespace('accounts')
      .description('Read the current account and any migration notice')
      .handler(() => {
        calls.push('read');
        return {
          revision: 7,
          note: 'Use the replacement account new-account for this update.',
        };
      })
      .build();
    const update = fn('update')
      .namespace('accounts')
      .description('Update the specified account at its expected revision')
      .arg('id', f.string())
      .arg('revision', f.number())
      .resultPolicy('data')
      .handler(({ id, revision }) => {
        calls.push(`update:${id}:${revision}`);
        return { updated: true };
      })
      .build();
    const assistant = agent('task:string -> answer:string', {
      functions: [read, update],
      directResponse: 'off',
      contextFields: [],
      maxTurns: 2,
      ...(preset ? { contextPolicy: { preset } } : {}),
    });

    await assistant.forward(model, { task: 'Read and update the account.' });

    expect(executorTurns).toBe(2);
    expect(calls).toEqual(['read', 'update:new-account:7']);
  }
);

function executionHelpers(
  observations: TurnObservations,
  execute: AxCodeSession['execute'],
  executeWithStatus?: AxCodeSession['executeWithStatus'],
  options?: Partial<
    Pick<ExecutionHelperDeps, 'effectiveAbortSignal' | 'completionState'>
  >
) {
  const session: AxCodeSession = {
    execute,
    executeWithStatus,
    patchGlobals: async () => {},
    close: () => {},
  };
  return buildExecutionHelpers({
    s: { shouldBubbleUserError: () => false },
    sessionRef: { current: session },
    protectedRuntimeNames: [],
    completionState: { payload: undefined },
    getMaxRuntimeChars: () => 400,
    waitForCompletionSignal: async () => {},
    detectCompletionSignalCalls: false,
    createSession: () => session,
    ...options,
    observations,
  });
}

describe('bounded observation feedback', () => {
  it('ignores a real tool wrapper result that arrives after its runtime generation ended', async () => {
    const observations = new TurnObservations();
    let settle!: (value: string) => void;
    const read = fn('read')
      .description('Read a record asynchronously')
      .handler(
        () =>
          new Promise<string>((resolve) => {
            settle = resolve;
          })
      )
      .build();
    const wrapped = wrapFunction(
      read,
      undefined,
      undefined,
      undefined,
      'records.read',
      undefined,
      'external',
      undefined,
      undefined,
      undefined,
      observations
    );
    const pending = wrapped({});
    observations.invalidate();
    observations.recordResult('records.current', 'current result');
    settle('late result from old execution');
    await pending;
    expect(observations.render(400)).toContain('current result');
    expect(observations.render(400)).not.toContain('late result');
    observations.reset();
    expect(() => observations.assertCanAct()).not.toThrow();
  });

  it('preserves a trailing field after a large data field without semantic key rules', () => {
    const observations = new TurnObservations();
    observations.recordResult('records.read', {
      rows: Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        value: 'payload',
      })),
      detail: 'Use the replacement account new-account.',
    });
    const rendered = observations.render(400, 'unrelated output '.repeat(1000));
    expect(rendered).toContain('"rows":');
    expect(rendered).toContain('"detail":');
    expect(rendered).toContain('Use the replacement account new-account.');
    expect(rendered.length).toBeLessThanOrEqual(400);
  });

  it('keeps small structured results intact', () => {
    const observations = new TurnObservations();
    observations.recordResult('records.read', { id: 'a', count: 2 });
    expect(observations.render(400)).toContain(
      JSON.stringify({ id: 'a', count: 2 }, null, 2)
    );
  });

  it('invalidates pending work without allowing late results or discovery to cross generations', async () => {
    const observations = new TurnObservations();
    const oldGeneration = observations.captureGeneration();
    const finish = observations.beginCall('records.read');
    const waiting = observations.waitForPending();
    observations.invalidate();
    await waiting;
    observations.recordResult('records.read', 'stale result', oldGeneration);
    observations.finishDiscovery(oldGeneration);
    finish();
    expect(observations.render(400)).toBe('');
    expect(() => observations.assertCanAct()).not.toThrow();
    observations.recordResult(
      'records.read',
      'current result',
      observations.captureGeneration()
    );
    expect(observations.render(400)).toContain('current result');
  });

  it.each(['timeout', 'restart', 'abort'] as const)(
    'invalidates late custom runtime results after %s',
    async (reason) => {
      const observations = new TurnObservations();
      const controller = new AbortController();
      let lateResult!: () => void;
      let executions = 0;
      const helpers = executionHelpers(
        observations,
        async () => {
          if (++executions > 1) return 'fresh session';
          const generation = observations.captureGeneration();
          const finish = observations.beginCall('records.read');
          lateResult = () => {
            observations.recordResult(
              'records.read',
              'stale result',
              generation
            );
            finish();
          };
          if (reason === 'abort') controller.abort(new Error('Stopped'));
          throw new Error(
            reason === 'timeout'
              ? 'Execution timed out'
              : reason === 'restart'
                ? 'Session is closed'
                : 'Aborted'
          );
        },
        undefined,
        { effectiveAbortSignal: controller.signal }
      );
      if (reason === 'abort')
        await expect(helpers.executeActorCode('ignored')).rejects.toThrow();
      else await helpers.executeActorCode('ignored');
      lateResult();
      await observations.waitForPending();
      expect(observations.render(400)).toBe('');
      expect(() => observations.assertCanAct()).not.toThrow();
    }
  );

  it('retains completed sibling results when a host requests guidance', async () => {
    const observations = new TurnObservations();
    const completionState: ExecutionHelperDeps['completionState'] = {
      payload: undefined,
    };
    const helpers = executionHelpers(
      observations,
      async () => {
        observations.recordResult('records.read', 'Already read record 7.');
        completionState.payload = {
          type: 'guide_agent',
          guidance: 'Use a different input',
          triggeredBy: 'records.update',
        };
        return '(no output)';
      },
      undefined,
      { completionState }
    );
    const result = await helpers.executeActorCode('ignored');
    expect(result.output).toContain('Already read record 7.');
    expect(result.output).toContain('Guidance recorded');
    expect(result.hasObservationFeedback).toBe(true);
  });

  it.each(['result', 'pause', 'error'] as const)(
    'retains observation feedback after a closed session retries with %s',
    async (outcome) => {
      const observations = new TurnObservations();
      let calls = 0;
      const helpers = executionHelpers(observations, async () => {
        if (++calls === 1) throw new Error('Session is closed');
        const finish = observations.beginCall('records.read');
        setTimeout(() => {
          observations.recordResult('records.read', 'Use new-record.');
          finish();
        }, 5);
        if (outcome === 'pause') observations.assertCanAct();
        if (outcome === 'error') throw new Error('Retry computation failed');
        return '(no output)';
      });
      const result = await helpers.executeActorCode('ignored');
      expect(calls).toBe(2);
      expect(result.isError).toBe(outcome === 'error');
      expect(result.output).toContain('Use new-record.');
      expect(result.output).toContain('runtime was restarted');
      if (outcome === 'error')
        expect(result.output).toContain('Retry computation failed');
    }
  );

  it('keeps fresh evidence visible within one budget despite large stdout', () => {
    const observations = new TurnObservations();
    observations.recordResult(
      'records.read',
      'The requested record moved to new-record.'
    );
    const rendered = observations.render(300, 'unrelated output '.repeat(1000));
    expect(rendered).toContain('The requested record moved to new-record.');
    expect(rendered.length).toBeLessThanOrEqual(300);
    expect(observations.render(20).length).toBeLessThanOrEqual(20);
  });

  it('includes identical stdout and tool result evidence only once', () => {
    const observations = new TurnObservations();
    observations.recordResult('records.read', 'Use new-record.');
    const rendered = observations.render(300, 'Use new-record.');
    expect(rendered.match(/Use new-record\./g)).toHaveLength(1);
  });

  it('preserves a meaningful error that mentions an observation pause', async () => {
    const observations = new TurnObservations();
    observations.recordResult('records.read', 'Use new-record.');
    expect(() => observations.assertCanAct()).toThrow();
    const helpers = executionHelpers(
      observations,
      async () => '',
      async () => ({
        value:
          'TypeError: AxAgentObservationRequired was caught, but record.id is missing',
        isError: true,
      })
    );
    const result = await helpers.executeActorCode('ignored');
    expect(result.isError).toBe(true);
    expect(result.isCodeError).toBe(true);
    expect(result.output).toContain('TypeError:');
    expect(result.output).toContain('record.id is missing');
    expect(result.output).toContain('Use new-record.');
    expect(result.output.length).toBeLessThanOrEqual(400);
  });

  it.each(['actor', 'test'] as const)(
    'settles pending inspection before returning %s feedback from a custom runtime',
    async (mode) => {
      const observations = new TurnObservations();
      const helpers = executionHelpers(observations, async () => {
        const finish = observations.beginCall('records.read');
        setTimeout(() => {
          observations.recordResult('records.read', 'Use new-record.');
          finish();
        }, 5);
        return '(no output)';
      });
      const result =
        mode === 'actor'
          ? (await helpers.executeActorCode('ignored')).output
          : await helpers.executeTestCode('ignored');
      expect(result).toContain('Use new-record.');
    }
  );

  it.each(['actor', 'test'] as const)(
    'retains completed inspection when a custom runtime rejects in %s mode',
    async (mode) => {
      const observations = new TurnObservations();
      const helpers = executionHelpers(observations, async () => {
        const finish = observations.beginCall('records.read');
        setTimeout(() => {
          observations.recordResult('records.read', 'Use new-record.');
          finish();
        }, 5);
        throw new Error('Computation failed after starting the read');
      });
      if (mode === 'actor') {
        const result = await helpers.executeActorCode('ignored');
        expect(result.isError).toBe(true);
        expect(result.output).toContain('Use new-record.');
        expect(result.output).toContain('Computation failed');
      } else {
        await expect(helpers.executeTestCode('ignored')).rejects.toThrow(
          'Use new-record.'
        );
      }
    }
  );

  it.each(['actor', 'test'] as const)(
    'returns pending observation evidence after a custom runtime pause in %s mode',
    async (mode) => {
      const observations = new TurnObservations();
      const helpers = executionHelpers(observations, async () => {
        const finish = observations.beginCall('records.read');
        setTimeout(() => {
          observations.recordResult('records.read', 'Use new-record.');
          finish();
        }, 5);
        observations.assertCanAct();
      });
      if (mode === 'actor') {
        const result = await helpers.executeActorCode('ignored');
        expect(result.isError).toBe(false);
        expect(result.output).toContain('Use new-record.');
      } else {
        expect(await helpers.executeTestCode('ignored')).toContain(
          'Use new-record.'
        );
      }
    }
  );
});
