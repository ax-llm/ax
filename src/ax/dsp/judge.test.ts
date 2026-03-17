import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import { AxJudge } from './judge.js';

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

describe('AxJudge', () => {
  it('should append description guidance, pass forward options, and use generic system-output wording', async () => {
    let capturedPrompt = '';
    let capturedModel: string | undefined;
    let capturedInstruction = '';
    const setInstructionSpy = vi
      .spyOn(AxGen.prototype, 'setInstruction')
      .mockImplementation((instruction: string) => {
        capturedInstruction = instruction;
        return undefined;
      });

    const judgeAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        capturedPrompt = req.chatPrompt
          .map((message) => String(message.content ?? ''))
          .join('\n');
        capturedModel = req.model as string | undefined;

        return {
          results: [
            {
              index: 0,
              content: 'Reasoning: looks correct\nQuality: excellent',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const judge = new AxJudge(
      new AxSignature('question:string -> answer:string'),
      {
        ai: judgeAI,
        model: 'judge-model',
        description: 'Be strict about tool-use correctness.',
      }
    );

    const result = await judge.evaluate(
      { question: 'What happened?' },
      { answer: 'The task was completed.' }
    );

    expect(result.score).toBe(1);
    expect(capturedModel).toBe('judge-model');
    expect(capturedPrompt).toContain('AI system output');
    expect(capturedInstruction).toContain('Additional Judge Guidance');
    expect(capturedInstruction).toContain(
      'Be strict about tool-use correctness.'
    );
    setInstructionSpy.mockRestore();
  });
});
