import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { flow } from '../flow/flow.js';
import { AxGen } from './generate.js';
import { bestOfN, refine } from './refine.js';

describe('bestOfN/refine', () => {
  it('uses native AxGen sampleCount/resultPicker and selects the best sample', async () => {
    let capturedN: number | undefined;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });
    ai.chat = async (req) => {
      capturedN = req.modelConfig?.n;
      return {
        results: [
          { index: 0, content: 'Answer: short', finishReason: 'stop' },
          {
            index: 1,
            content: 'Answer: much better answer',
            finishReason: 'stop',
          },
          { index: 2, content: 'Answer: ok', finishReason: 'stop' },
        ],
      } as AxChatResponse;
    };

    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    const picked = bestOfN(gen, {
      n: 3,
      rewardFn: ({ prediction }) => prediction.answer.length,
    });

    const result = await picked.forward(ai, { question: 'pick one' });

    expect(capturedN).toBe(3);
    expect(result.answer).toBe('much better answer');
    expect(picked.getAttempts()).toHaveLength(3);
    expect(picked.getAttempts()[1]?.reward).toBeGreaterThan(
      picked.getAttempts()[0]?.reward ?? 0
    );
  });

  it('uses serial complete-program attempts for non-AxGen programs', async () => {
    let calls = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });
    ai.chat = async () => {
      calls++;
      return {
        results: [
          {
            index: 0,
            content: `Answer: ${calls === 1 ? 'bad' : 'excellent'}`,
            finishReason: 'stop',
          },
        ],
      } as AxChatResponse;
    };

    const wf = flow<{ question: string }, { answer: string }>()
      .node('qa', 'question:string -> answer:string')
      .execute('qa', (state) => ({ question: state.question }))
      .returns((state) => ({ answer: state.qaResult.answer }));
    const picked = bestOfN(wf, {
      n: 3,
      strategy: 'serial',
      threshold: 1,
      rewardFn: ({ prediction }) => (prediction.answer === 'excellent' ? 1 : 0),
    });

    const result = await picked.forward(ai, { question: 'pick one' });

    expect(result.answer).toBe('excellent');
    expect(calls).toBe(2);
    expect(picked.getAttempts()).toHaveLength(2);
  });

  it('generates advice between refine rounds and restores instructions', async () => {
    const genAI = new AxMockAIService({
      features: { functions: false, streaming: false },
    });
    genAI.chat = async (req: Readonly<AxChatRequest>) => {
      const prompt = JSON.stringify(req.chatPrompt);
      const improved = prompt.includes('say improved');
      return {
        results: [
          {
            index: 0,
            content: `Answer: ${improved ? 'improved' : 'bad'}`,
            finishReason: 'stop',
          },
        ],
      } as AxChatResponse;
    };

    const feedbackAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Summary: ask the generator to improve\nAdvice: ```json\n{"root::instruction":"say improved"}\n```',
            finishReason: 'stop',
          },
        ],
      },
    });

    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    gen.setInstruction('Answer the question.');

    const improved = refine(gen, {
      rounds: 2,
      samplesPerRound: 1,
      threshold: 1,
      feedbackAI,
      rewardFn: ({ prediction }) => (prediction.answer === 'improved' ? 1 : 0),
    });

    const result = await improved.forward(genAI, { question: 'test' });

    expect(result.answer).toBe('improved');
    expect(gen.getInstruction()).toBe('Answer the question.');
    expect(improved.getAttempts()[0]?.adviceApplied).toBe(true);
  });

  it('throws a clear error for streamingForward', async () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    const picked = bestOfN(gen, {
      n: 2,
      rewardFn: ({ prediction }) => prediction.answer.length,
    });

    await expect(async () => {
      for await (const _chunk of picked.streamingForward({} as any, {
        question: 'x',
      })) {
        // No chunks expected.
      }
    }).rejects.toThrow(/do not support streamingForward/);
  });
});
