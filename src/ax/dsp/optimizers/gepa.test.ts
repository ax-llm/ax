import { AxGEPA } from './gepa.js';
import { ax } from '../template.js';
import type { AxAIService } from '../../ai/types.js';
import { vi, describe, it, expect } from 'vitest';

describe('AxGEPA Optimizer', () => {
  it('should use the instruction from the program', async () => {
    const ai: AxAIService = {
      name: 'mockAI',
      chat: vi.fn().mockResolvedValue({
        results: [{ content: JSON.stringify({ answer: '4' }) }],
      }),
      getOptions: vi.fn().mockReturnValue({}),
      getLogger: vi.fn().mockReturnValue(undefined),
      clone: vi.fn().mockReturnThis(),
    };

    const program = ax('question:string -> answer:string');
    const customInstruction = 'This is a custom instruction.';
    program.setInstruction(customInstruction);

    const examples = [
      { question: 'What is 2+2?', answer: '4' },
      { question: 'What is 3+3?', answer: '6' },
    ];

    const metricFn = () => 1;

    const optimizer = new AxGEPA({
      studentAI: ai,
      teacherAI: ai,
      numTrials: 1, // Run only one trial for a predictable test
    });

    // Spy on getBaseInstruction to confirm it's called and what it returns.
    const getBaseInstructionSpy = vi.spyOn(
      optimizer,
      'getBaseInstruction' as any
    );

    // Mock the reflectInstruction to prevent it from running and making real AI calls
    const reflectSpy = vi
      .spyOn(optimizer, 'reflectInstruction' as any)
      .mockResolvedValue('a new evolved instruction');

    await optimizer.compile(program, examples, metricFn, {
      maxMetricCalls: 10,
    });

    // 1. Verify that our patched getBaseInstruction is working
    expect(getBaseInstructionSpy).toHaveBeenCalled();
    const baseInstruction = await getBaseInstructionSpy.mock.results[0].value;
    expect(baseInstruction).toBe(customInstruction);

    // 2. Verify that this base instruction is passed to the first reflection call
    expect(reflectSpy).toHaveBeenCalled();
    expect(reflectSpy).toHaveBeenCalledWith(
      customInstruction,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });
});
