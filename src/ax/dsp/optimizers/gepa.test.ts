import { describe, expect, it } from 'vitest';
import { ax } from '../template.js';
import type { AxAIService } from '../../ai/types.js';
import { AxGEPA } from './gepa.js';

describe('AxGEPA Optimizer', () => {
  describe('getBaseInstruction', () => {
    it('should use the description from the signature when available', async () => {
      // Create a program with a signature that has a description
      const program = ax(
        '"This is my custom task description" question:string -> answer:string'
      );

      // Access the private method via cast
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      // Call getBaseInstruction
      const instruction = await (optimizer as any).getBaseInstruction(program);

      // It should return the description from the signature, not the default
      expect(instruction).toBe('This is my custom task description');
      expect(instruction).not.toBe(
        'Follow the task precisely. Be concise, correct, and consistent.'
      );
    });

    it('should fall back to default when signature has no description', async () => {
      // Create a program without a description
      const program = ax('question:string -> answer:string');

      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      const instruction = await (optimizer as any).getBaseInstruction(program);

      // Should use the default fallback
      expect(instruction).toBe(
        'Follow the task precisely. Be concise, correct, and consistent.'
      );
    });

    it('should use custom instruction when set via setInstruction', async () => {
      const program = ax('question:string -> answer:string');
      program.setInstruction('My explicitly set custom instruction');

      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      const instruction = await (optimizer as any).getBaseInstruction(program);

      // Should return the custom instruction
      expect(instruction).toBe('My explicitly set custom instruction');
    });
  });
});
