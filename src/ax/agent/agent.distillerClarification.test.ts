import { expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxAgentClarificationError, agent } from './index.js';

it('exports distiller bindings when clarification ends the shared runtime', async () => {
  let distillerTurns = 0;
  let executorTurns = 0;
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = String(request.chatPrompt[0]?.content ?? '');
      let code: string;
      if (system.includes('You (`distiller`)')) {
        code =
          ++distillerTurns === 1
            ? 'var selectedRecord = {id:"replacement", revision:7}; await askClarification("Confirm the replacement?");'
            : 'await final("Update the confirmed record", {selectedRecord});';
      } else if (system.includes('You (`executor`)')) {
        executorTurns++;
        code =
          'if (inputs.distilledContext.selectedRecord.id !== "replacement" || selectedRecord.revision !== 7) throw new Error("Lost clarification state"); await final("Report", {selectedRecord});';
      } else
        return {
          results: [
            { index: 0, content: 'Answer: confirmed', finishReason: 'stop' },
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
  const a = agent('task:string, notes?:string -> answer:string', {
    contextFields: [],
    directResponse: 'off',
    relevanceRanking: false,
    maxTurns: 3,
  });
  let clarification: AxAgentClarificationError | undefined;
  try {
    await a.forward(ai, {
      task: 'Select a record, then confirm before updating.',
    });
  } catch (error) {
    if (!(error instanceof AxAgentClarificationError)) throw error;
    clarification = error;
  }
  expect(clarification?.question).toBe('Confirm the replacement?');
  const state = clarification!.getState();
  expect(state?.runtimeBindings.selectedRecord).toEqual({
    id: 'replacement',
    revision: 7,
  });
  a.setState(state);
  expect(
    await a.forward(ai, {
      task: 'Select a record, then confirm before updating.',
      notes: 'Yes.',
    })
  ).toEqual({ answer: 'confirmed' });
  expect(distillerTurns).toBe(2);
  expect(executorTurns).toBe(1);
});
