import { describe, expect, it } from 'vitest';
import { AxBaseAI } from '../ai/base.js';
import type { AxAIServiceImpl, AxChatResponse } from '../ai/types.js';
import { flow } from '../flow/flow.js';
import { ax } from './template.js';

const EXPENSIVE_MODEL_ERROR =
  'Model premium-model is marked as expensive and requires explicit confirmation. Set useExpensiveModel: "yes" to proceed.';

const cannedResponse = (): AxChatResponse => ({
  results: [{ index: 0, content: 'Answer Text: ok', finishReason: 'stop' }],
});

// A real AxBaseAI, so the isExpensive gate in AxBaseAI._chat1 runs, over a
// canned localCall transport. Its only model is marked isExpensive and there
// is no model-key entry that could supply useExpensiveModel on its own.
const makeExpensiveAI = () => {
  let requestCount = 0;
  const impl: AxAIServiceImpl<
    string,
    string,
    object,
    never,
    AxChatResponse,
    AxChatResponse,
    never
  > = {
    createChatReq: () => {
      requestCount++;
      return [
        {
          name: 'chat',
          localCall: async <TRequest, TResponse>(
            _req: TRequest,
            stream?: boolean
          ) =>
            (stream
              ? new ReadableStream<AxChatResponse>({
                  start(controller) {
                    controller.enqueue(cannedResponse());
                    controller.close();
                  },
                })
              : cannedResponse()) as unknown as TResponse,
        },
        {},
      ];
    },
    createChatResp: (resp) => ({ ...resp }),
    createChatStreamResp: (resp) => ({ ...resp }),
    getModelConfig: () => ({}),
    getTokenUsage: () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }),
  };
  const ai = new AxBaseAI<
    string,
    string,
    object,
    never,
    AxChatResponse,
    AxChatResponse,
    never,
    string
  >(impl, {
    name: 'premium-mock',
    headers: async () => ({}),
    modelInfo: [
      {
        name: 'premium-model',
        promptTokenCostPer1M: 150,
        completionTokenCostPer1M: 600,
        isExpensive: true,
      },
    ],
    defaults: { model: 'premium-model' },
    supportFor: {
      functions: true,
      streaming: true,
      media: {
        images: { supported: false, formats: [] },
        audio: { supported: false, formats: [] },
        files: { supported: false, formats: [], uploadMethod: 'none' },
        urls: { supported: false, webSearch: false, contextFetching: false },
      },
      caching: { supported: false, types: [] },
      thinking: false,
      multiTurn: true,
    },
  });
  return { ai, requestCount: () => requestCount };
};

const signature = 'questionText:string -> answerText:string';

// AxProgramForwardOptions extends AxAIServiceOptions, so useExpensiveModel
// typechecks on forward() and in the ax() constructor options. generate.ts
// builds the ai.chat options field by field, so it has to be listed there
// explicitly or the opt-in is silently dropped and the call is rejected.
describe('useExpensiveModel reaches the AI service from AxGen', () => {
  for (const stream of [false, true]) {
    describe(`stream: ${stream}`, () => {
      it('still rejects an expensive model without the opt-in', async () => {
        const { ai, requestCount } = makeExpensiveAI();

        await expect(
          ax(signature).forward(ai, { questionText: 'x' }, { stream })
        ).rejects.toThrow(EXPENSIVE_MODEL_ERROR);
        expect(requestCount()).toBe(0);
      });

      it('forwards useExpensiveModel given in forward options', async () => {
        const { ai, requestCount } = makeExpensiveAI();

        const result = await ax(signature).forward(
          ai,
          { questionText: 'x' },
          { stream, useExpensiveModel: 'yes' }
        );

        expect(result.answerText).toBe('ok');
        expect(requestCount()).toBe(1);
      });

      it('falls back to useExpensiveModel given in ax() options', async () => {
        const { ai, requestCount } = makeExpensiveAI();

        const result = await ax(signature, {
          useExpensiveModel: 'yes',
        }).forward(ai, { questionText: 'x' }, { stream });

        expect(result.answerText).toBe('ok');
        expect(requestCount()).toBe(1);
      });
    });
  }

  it('forwards useExpensiveModel through streamingForward', async () => {
    const { ai } = makeExpensiveAI();

    const deltas: unknown[] = [];
    for await (const delta of ax(signature).streamingForward(
      ai,
      { questionText: 'x' },
      { useExpensiveModel: 'yes' }
    )) {
      deltas.push(delta);
    }

    expect(deltas.length).toBeGreaterThan(0);
  });

  it('forwards useExpensiveModel from flow forward options to node programs', async () => {
    const wf = flow<{ questionText: string }, { answerText: string }>()
      .node('answerer', signature)
      .execute('answerer', (state) => ({ questionText: state.questionText }))
      .returns((state) => ({ answerText: state.answererResult.answerText }));

    await expect(
      wf.forward(makeExpensiveAI().ai, { questionText: 'x' }, { stream: false })
    ).rejects.toThrow(EXPENSIVE_MODEL_ERROR);

    const result = await wf.forward(
      makeExpensiveAI().ai,
      { questionText: 'x' },
      { stream: false, useExpensiveModel: 'yes' }
    );
    expect(result.answerText).toBe('ok');
  });
});
