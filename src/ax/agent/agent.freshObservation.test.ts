import { expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { fn } from '../dsp/sig.js';
import { TurnObservations } from './agentInternal/turnObservations.js';
import { agent } from './index.js';

it('keeps complete compact arrays and nested schemas when they fit the observation budget', () => {
  const observations = new TurnObservations();
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `item_${i}`,
    value: i,
  }));
  const result = {
    rows,
    schema: { success: { record: { required: ['revision'], type: 'object' } } },
  };
  observations.recordResult('catalog', result);
  const output = observations.render(3000);
  expect(output.length).toBeLessThanOrEqual(3000);
  const preview = JSON.parse(
    output.slice('catalog: '.length, output.indexOf('\n[OBSERVATION]'))
  );
  expect(preview).toEqual(result);
});

it('does not omit a middle array entry when the entire compact result fits', () => {
  const observations = new TurnObservations();
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `item_${i}`,
    value: i,
  }));
  observations.recordResult('read', rows);
  const output = observations.render(1000);
  expect(output).toContain('item_7');
  expect(
    JSON.parse(output.slice('read: '.length, output.indexOf('\n[OBSERVATION]')))
  ).toEqual(rows);
});

it('full replay preserves the configured budget for fresh observations after long history', async () => {
  let turn = 0;
  const late = 'Fresh evidence. '.repeat(100);
  const outputs: string[] = [];
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = String(request.chatPrompt[0]?.content ?? '');
      let code: string;
      if (system.includes('You (`distiller`)'))
        code = 'await final("Read the current state", {});';
      else if (system.includes('You (`executor`)')) {
        turn++;
        if (turn <= 2)
          code = `console.log(${JSON.stringify('Old history. '.repeat(800))});`;
        else if (turn === 3) code = 'var fresh = await warehouse.read();';
        else {
          expect(outputs.at(-1)).toContain(late);
          expect(JSON.stringify(request.chatPrompt)).toContain(late);
          code = 'await final("Report", {fresh});';
        }
      } else
        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
        };
      return {
        results: [
          {
            index: 0,
            content: `Javascript Code: ${code}`,
            finishReason: 'stop',
          },
        ],
      };
    },
  });
  const a = agent('task:string -> answer:string', {
    functions: [
      fn('read')
        .namespace('warehouse')
        .description('Read fresh evidence')
        .handler(() => late)
        .build(),
    ],
    contextFields: [],
    functionDiscovery: false,
    relevanceRanking: false,
    directResponse: 'off',
    contextPolicy: { preset: 'full' },
    maxRuntimeChars: 3000,
    maxTurns: 6,
    actorTurnCallback: (t) => {
      if (t.stage === 'executor') outputs.push(t.output);
    },
  });
  expect(
    await a.forward(ai, { task: 'Read fresh evidence after prior work.' })
  ).toEqual({ answer: 'done' });
  expect(outputs.every((output) => output.length <= 3000)).toBe(true);
});

it('labels interrupted programs and does not infer completed writes from their suffix', async () => {
  const {
    buildActionLogWithPolicy,
    extractWorkingCodeState,
    serializeTrajectoryEntries,
  } = await import('./contextManager.js');
  const {
    serializeAgentStateActionLogEntries,
    deserializeAgentStateActionLogEntries,
  } = await import('./state.js');
  const entry = {
    turn: 1,
    code: 'var observed = await warehouse.read(); var neverCreated = await warehouse.write(); await final("Done", {});',
    output: 'Execution paused before warehouse.write. Read the new result.',
    tags: ['paused' as const],
    _functionCalls: [{ qualifiedName: 'warehouse.read' }],
  };
  const text = buildActionLogWithPolicy([entry], { actionReplay: 'full' });
  expect(text).toContain('Execution paused. Unexecuted code is omitted');
  expect(text).not.toContain('neverCreated');
  expect(extractWorkingCodeState([entry])).not.toContain('neverCreated');
  expect(serializeTrajectoryEntries([entry])).not.toContain('neverCreated');
  const roundTrip = deserializeAgentStateActionLogEntries(
    serializeAgentStateActionLogEntries([entry])
  );
  expect(
    buildActionLogWithPolicy(roundTrip, { actionReplay: 'full' })
  ).toContain('Execution paused');
  expect(roundTrip[0]?.producedVars).not.toContain('neverCreated');
  expect(roundTrip[0]?.stepKind).not.toBe('finalize');
});

it('makes the next model turn distinguish completed calls from an unexecuted program suffix', async () => {
  let turn = 0;
  const writes: string[] = [];
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = String(request.chatPrompt[0]?.content ?? '');
      let code: string;
      if (system.includes('You (`distiller`)'))
        code = 'await final("Read then write", {});';
      else if (system.includes('You (`executor`)')) {
        turn++;
        if (turn === 1)
          code =
            'var observed = await warehouse.read(); var neverCreated = await warehouse.write({route:"wrong"}); await final("Done", {});';
        else if (turn === 2) {
          const prompt = JSON.stringify(request.chatPrompt);
          expect(writes).toEqual([]);
          expect(prompt).toContain('Execution paused before warehouse.write');
          expect(prompt).toContain('Unexecuted code is omitted');
          expect(prompt, prompt.match(/Initialized.{0,400}/)?.[0]).toMatch(
            /Initialized bindings after pause: [^.]*observed/
          );
          expect(prompt).not.toContain('neverCreated');
          code = 'await warehouse.write({route: observed.route});';
        } else code = 'await final("Report", {route: observed.route});';
      } else
        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
        };
      return {
        results: [
          {
            index: 0,
            content: `Javascript Code: ${code}`,
            finishReason: 'stop',
          },
        ],
      };
    },
  });
  const { f } = await import('../dsp/sig.js');
  const a = agent('task:string -> answer:string', {
    functions: [
      fn('read')
        .namespace('warehouse')
        .description('Read route')
        .handler(() => ({ route: 'replacement' }))
        .build(),
      fn('write')
        .namespace('warehouse')
        .description('Write route')
        .arg('route', f.string())
        .handler(({ route }) => {
          writes.push(route);
          return 'done';
        })
        .build(),
    ],
    contextFields: [],
    functionDiscovery: false,
    relevanceRanking: false,
    directResponse: 'off',
    contextPolicy: { preset: 'full' },
    maxTurns: 5,
  });
  await a.forward(ai, { task: 'Read and write the observed route.' });
  expect(writes).toEqual(['replacement']);
});
