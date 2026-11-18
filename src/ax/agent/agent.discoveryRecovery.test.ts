import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { fn } from '../dsp/sig.js';
import { agent } from './index.js';

// Use unrelated fictitious domains: recovery must follow the actual catalog,
// not a benchmark name or a known spelling of a business API.
describe('discovery misses', () => {
  it.each(['warehouse', 'calendar', 'devices'])(
    'recovers from an invented %s callable without claiming it was loaded',
    async (guessed) => {
      const calls: string[] = [];
      let turn = 0;
      const outputs: string[] = [];
      const ai = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (request) => {
          const system = String(request.chatPrompt[0]?.content ?? '');
          const prompt = JSON.stringify(request.chatPrompt);
          let code: string;
          if (system.includes('You (`distiller`)'))
            code = 'await final("Use available tools", {});';
          else if (system.includes('You (`executor`)')) {
            turn++;
            if (turn === 1)
              code = `await discover(['${guessed}.invented', 'actual.read']); await actual.read();`;
            else if (turn === 2) {
              expect(calls).toEqual([]);
              expect(prompt).toContain('No callable found');
              expect(prompt).toContain('actual.read');
              expect(prompt).not.toContain(
                'Discovery docs now available for functions: ' +
                  guessed +
                  '.invented'
              );
              expect(prompt).not.toContain(`### \`${guessed}.invented\``);
              code = 'var value = await actual.read();';
            } else {
              expect(prompt).toContain('observed-new-information');
              code = 'await final("Report the observed information", {value});';
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
            .namespace('actual')
            .description('Read the actual state.')
            .handler(() => {
              calls.push('read');
              return 'observed-new-information';
            })
            .build(),
        ],
        functionDiscovery: true,
        relevanceRanking: false,
        contextFields: [],
        directResponse: 'off',
        contextPolicy: { preset: 'full' },
        maxTurns: 4,
        actorTurnCallback: (t) => {
          if (t.stage === 'executor') outputs.push(t.output);
        },
      });
      await a.forward(ai, { task: 'Read the available state.' });
      expect(turn).toBe(3);
      expect(calls).toEqual(['read']);
      expect(outputs[0]).toContain('No callable found');
      expect(outputs[0]).toContain(
        'Discovery docs now available for functions: actual.read'
      );
      expect(
        a
          .getState()
          ?.discoveryPromptState?.functions?.some(
            (v) => v.qualifiedName === `${guessed}.invented`
          )
      ).not.toBe(true);
      expect(
        a
          .getState()
          ?.discoveryPromptState?.functions?.some(
            (v) => v.qualifiedName === 'actual.read'
          )
      ).toBe(true);
    }
  );
});
