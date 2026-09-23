import { describe, expect, it } from 'vitest';
import { AxBaseAI } from '../../ai/base.js';
import { AxMockAIService } from '../../ai/mock/api.js';
import type {
  AxAIService,
  AxAIServiceImpl,
  AxChatRequest,
  AxChatResponse,
  AxLoggerData,
} from '../../ai/types.js';
import { optimize } from '../optimize.js';
import { ax } from '../template.js';
import { AxACE } from './ace.js';
import { AxBootstrapFewShot } from './bootstrapFewshot.js';
import { AxGEPA } from './gepa.js';

const EXPENSIVE_MODEL_ERROR =
  'Model premium-model is marked as expensive and requires explicit confirmation. Set useExpensiveModel: "yes" to proceed.';

// A real AxBaseAI, so the isExpensive gate in AxBaseAI._chat1 runs, over a
// canned localCall transport. Its only model is marked isExpensive. Each
// request is answered by the output field its system prompt asks for, and
// recorded under that field's wire key. The gate throws before
// createChatReq, so a rejected call records nothing.
const makeExpensiveTeacher = (answers: Readonly<Record<string, string>>) => {
  const requests: string[] = [];
  const impl: AxAIServiceImpl<
    string,
    string,
    object,
    never,
    AxChatResponse,
    AxChatResponse,
    never
  > = {
    createChatReq: (req: Readonly<AxChatRequest<string>>) => {
      const system = String(req.chatPrompt[0]?.content ?? '');
      const key = Object.keys(answers).find((wireKey) =>
        system.includes(`wire key: \`${wireKey}\``)
      );
      requests.push(key ?? 'unrouted');
      const response: AxChatResponse = {
        results: [
          {
            index: 0,
            content: key ? answers[key] : '',
            finishReason: 'stop',
          },
        ],
      };
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
                    controller.enqueue(response);
                    controller.close();
                  },
                })
              : response) as unknown as TResponse,
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
  return { ai: ai as AxAIService, requests: () => [...requests] };
};

const PROPOSED = 'Reply with the expected answer exactly.';

// Student program that never calls an AI: it answers correctly only once
// GEPA has installed the teacher's proposed instruction.
const createStudentProgram = () => {
  let id = 'root';
  let instruction = 'task';
  const program = {
    getId: () => id,
    setId: (nextId: string) => {
      id = nextId;
    },
    getSignature: () => ({
      getDescription: () => 'task',
      toString: () => '"task" question:string -> answer:string',
    }),
    namedProgramInstances: () => [{ id, program }],
    getOptimizableComponents: () => [
      { key: `${id}::instruction`, kind: 'instruction', current: instruction },
    ],
    applyOptimizedComponents: (updates: Readonly<Record<string, string>>) => {
      const next = updates[`${id}::instruction`];
      if (typeof next === 'string') instruction = next;
    },
    forward: async (_ai: AxAIService, example: { answer: string }) => ({
      answer: instruction === PROPOSED ? example.answer : 'wrong',
    }),
    getTraces: () => [],
    setDemos: () => {},
    applyOptimization: () => {},
    getUsage: () => [],
    resetUsage: () => {},
  };
  return program;
};

const trainingExamples = [
  { question: 'q1', answer: 'a1' },
  { question: 'q2', answer: 'a2' },
];

const exactMatch = async ({
  prediction,
  example,
}: Readonly<{ prediction: any; example: any }>) =>
  prediction.answer === example.answer ? 1 : 0;

const gepaTeacherAnswers = {
  feedbackSummary: 'Feedback Summary: Answers do not match the expected label.',
  newValue: `New Value: ${PROPOSED}`,
};

describe('teacherOptions on optimizer teacher calls', () => {
  describe('AxGEPA', () => {
    it('lets the proposer reach an expensive teacher when teacherOptions opt in', async () => {
      const teacher = makeExpensiveTeacher(gepaTeacherAnswers);
      const optimizer = new AxGEPA({
        studentAI: new AxMockAIService(),
        teacherAI: teacher.ai,
        teacherOptions: { useExpensiveModel: 'yes' },
        numTrials: 1,
        minibatch: false,
        seed: 1,
      });

      const result = await optimizer.compile(
        createStudentProgram() as any,
        trainingExamples,
        exactMatch,
        { maxMetricCalls: 20 }
      );

      expect(teacher.requests()).toEqual(['feedbackSummary', 'newValue']);
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': PROPOSED,
      });
    });

    it('surfaces the rejected teacher calls through the logger instead of silently keeping the instruction', async () => {
      const teacher = makeExpensiveTeacher(gepaTeacherAnswers);
      const logged: AxLoggerData[] = [];
      const optimizer = new AxGEPA({
        studentAI: new AxMockAIService(),
        teacherAI: teacher.ai,
        logger: (data) => logged.push(data),
        numTrials: 1,
        minibatch: false,
        seed: 1,
      });

      const result = await optimizer.compile(
        createStudentProgram() as any,
        trainingExamples,
        exactMatch,
        { maxMetricCalls: 20 }
      );

      expect(teacher.requests()).toEqual([]);
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': 'task',
      });
      const notifications = logged.filter(
        (data) => data.name === 'Notification' && data.id === 'gepa_teacher'
      );
      expect(notifications).toEqual([
        {
          name: 'Notification',
          id: 'gepa_teacher',
          value: expect.stringContaining(
            'summarizing feedback for root::instruction'
          ),
        },
        {
          name: 'Notification',
          id: 'gepa_teacher',
          value: expect.stringContaining(
            'proposing a new value for root::instruction'
          ),
        },
      ]);
      for (const notification of notifications) {
        expect((notification as { value: string }).value).toContain(
          EXPENSIVE_MODEL_ERROR
        );
      }
    });
  });

  describe('AxBootstrapFewShot', () => {
    for (const optIn of [true, false]) {
      it(`${optIn ? 'runs' : 'cannot run'} demo generation on an expensive teacher ${optIn ? 'with' : 'without'} teacherOptions`, async () => {
        const teacher = makeExpensiveTeacher({
          answerText: 'Answer Text: ok',
        });
        const optimizer = new AxBootstrapFewShot({
          studentAI: new AxMockAIService(),
          teacherAI: teacher.ai,
          ...(optIn ? { teacherOptions: { useExpensiveModel: 'yes' } } : {}),
          options: { maxRounds: 1, maxDemos: 1, verboseMode: false },
        });
        const compiled = optimizer.compile(
          ax('questionText:string -> answerText:string'),
          [{ questionText: 'q', answerText: 'ok' }],
          ({ prediction, example }) =>
            (prediction as any).answerText === example.answerText ? 1 : 0
        );

        if (optIn) {
          expect((await compiled).demos).toHaveLength(1);
          expect(teacher.requests()).toEqual(['answerText']);
        } else {
          await expect(compiled).rejects.toThrow('No demonstrations found');
          expect(teacher.requests()).toEqual([]);
        }
      });
    }
  });

  describe('AxACE', () => {
    it('sends reflector and curator calls to an expensive teacher with teacherOptions', async () => {
      const teacher = makeExpensiveTeacher({
        errorIdentification: [
          'Reasoning: The answer matched.',
          'Error Identification: no error',
          'Root Cause Analysis: none',
          'Correct Approach: keep answering directly',
          'Key Insight: direct answers work',
          'Bullet Tags: []',
        ].join('\n'),
        operations: 'Reasoning: Nothing to change.\nOperations: []',
      });
      const optimizer = new AxACE(
        {
          studentAI: new AxMockAIService({
            chatResponse: {
              results: [
                { index: 0, content: 'Answer: a', finishReason: 'stop' },
              ],
            },
          }),
          teacherAI: teacher.ai,
          teacherOptions: { useExpensiveModel: 'yes' },
        },
        { maxEpochs: 1, maxReflectorRounds: 1 }
      );

      await optimizer.compile(
        ax('question:string -> answer:string'),
        [
          { question: 'q1', answer: 'a' },
          { question: 'q2', answer: 'a' },
        ],
        () => 1
      );

      expect(teacher.requests()).toEqual([
        'errorIdentification',
        'operations',
        'errorIdentification',
        'operations',
      ]);
    });
  });

  describe('optimize()', () => {
    it('evolves an ax() program’s empty instruction through an expensive teacher', async () => {
      const teacher = makeExpensiveTeacher({
        answerText: 'Answer Text: ok',
        ...gepaTeacherAnswers,
      });
      // The student only answers correctly once the evolved instruction is
      // part of its prompt.
      const studentAI = new AxMockAIService<string>({
        chatResponse: async (req) => ({
          results: [
            {
              index: 0,
              content: JSON.stringify(req.chatPrompt).includes(PROPOSED)
                ? 'Answer Text: ok'
                : 'Answer Text: wrong',
              finishReason: 'stop',
            },
          ],
        }),
      });

      const result = await optimize(
        ax('questionText:string -> answerText:string'),
        [
          { questionText: 'q1', answerText: 'ok' },
          { questionText: 'q2', answerText: 'ok' },
        ],
        ({ prediction, example }) =>
          (prediction as any).answerText === example.answerText ? 1 : 0,
        {
          studentAI,
          teacherAI: teacher.ai,
          teacherOptions: { useExpensiveModel: 'yes' },
          numTrials: 1,
          minibatch: false,
          seed: 1,
          maxMetricCalls: 20,
        }
      );

      // Bootstrap runs the program on the teacher; GEPA then asks it for
      // feedback and a proposal for the program's empty instruction.
      const requests = teacher.requests();
      expect(requests).toContain('answerText');
      expect(requests.filter((key) => key !== 'answerText')).toEqual([
        'feedbackSummary',
        'newValue',
      ]);
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': PROPOSED,
      });
    });
  });
});
