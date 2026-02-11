import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { AxGen } from './generate.js';

describe('Duplicate function declarations (Issue #491)', () => {
  it('constructor-only functions are not duplicated', async () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string',
      {
        functions: [
          {
            name: 'getTime',
            description: 'returns the current time',
            func: () => 'NOW',
          },
        ],
      }
    );

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false },
    });

    let capturedReq: any;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: 'answer: done',
            finishReason: 'stop' as const,
          },
        ],
      };
    };

    await gen.forward(mockAI, { question: 'test' });

    const getTimeFns = capturedReq.functions?.filter(
      (fn: any) => fn.name === 'getTime'
    );
    expect(getTimeFns).toHaveLength(1);
  });

  it('per-call functions merge with constructor functions without duplication', async () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string',
      {
        functions: [
          {
            name: 'funcA',
            description: 'function A',
            func: () => 'A',
          },
        ],
      }
    );

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false },
    });

    let capturedReq: any;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: 'answer: done',
            finishReason: 'stop' as const,
          },
        ],
      };
    };

    await gen.forward(
      mockAI,
      { question: 'test' },
      {
        functions: [
          {
            name: 'funcB',
            description: 'function B',
            func: () => 'B',
          },
        ],
      }
    );

    const funcAMatches = capturedReq.functions?.filter(
      (fn: any) => fn.name === 'funcA'
    );
    const funcBMatches = capturedReq.functions?.filter(
      (fn: any) => fn.name === 'funcB'
    );
    expect(funcAMatches).toHaveLength(1);
    expect(funcBMatches).toHaveLength(1);
    expect(capturedReq.functions).toHaveLength(2);
  });
});
