import { describe, it, expect } from 'vitest';
import { AxPromptTemplate, type AxFieldTemplateFn } from './prompt';
import { AxSignature, type AxField } from './sig';
import type { AxMessage, AxGenIn, AxGenOut, AxFieldValue } from './types';
import type { AxChatRequest } from '../ai/types';

// Helper to create a basic signature
const createSignature = (desc: string, inputs: AxField[] = [], outputs: AxField[] = []) => {
  return new AxSignature(desc, inputs, outputs);
};

const defaultSig = createSignature(
  'input:string -> output:string',
  [{ name: 'input', title: 'Input', description: 'Input string' }],
  [{ name: 'output', title: 'Output', description: 'Output string' }]
);

const multiFieldSig = createSignature(
  'question:string, context:string -> answer:string',
  [
    { name: 'question', title: 'Question', description: 'Question string' },
    { name: 'context', title: 'Context', description: 'Context string' },
  ],
  [{ name: 'answer', title: 'Answer', description: 'Answer string' }]
);


describe('AxPromptTemplate.render', () => {
  describe('Single AxGenIn input (existing behavior)', () => {
    it('should render a basic prompt with single AxGenIn', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const values: AxGenIn = { input: 'hello world' };
      const result = pt.render(values, {});

      expect(result.length).toBe(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[1]?.content).toContain('Input: hello world');
    });

    it('should render with examples', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const values: AxGenIn = { input: 'test' };
      const examples = [{ input: 'ex_in', output: 'ex_out' }];
      const result = pt.render(values, { examples });

      expect(result[0]?.role).toBe('system');
      // Depending on examplesInSystemPrompt, examples might be in system or user prompt
      const systemContent = result[0]?.content as string;
      const userContent = result[1]?.content as string;

      expect(systemContent.includes('Input: ex_in\nOutput: ex_out') || userContent.includes('Input: ex_in\nOutput: ex_out')).toBe(true);
      expect(userContent.includes('Input: test')).toBe(true);

    });
  });

  describe('ReadonlyArray<AxMessage> input (new behavior)', () => {
    it('should render with a single user message in history', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { input: 'first message' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(2); // system, user
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[1]?.content).toBe('Input: first message');
    });

    it('should combine consecutive user messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1', context: 'c1' } },
        { role: 'user', values: { question: 'q2', context: 'c2' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(2); // system, user
      expect(result[1]?.role).toBe('user');
      expect(result[1]?.content).toBe('Question: q1\nContext: c1\nQuestion: q2\nContext: c2');
    });

    it('should render with a single assistant message in history', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'assistant', values: { output: 'assistant response' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(2); // system, assistant
      expect(result[1]?.role).toBe('assistant');
      expect(result[1]?.content).toBe('output: assistant response');
    });

    it('should combine consecutive assistant messages', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'assistant', values: { output: 'response a' } },
        { role: 'assistant', values: { output: 'response b' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(2); // system, assistant
      expect(result[1]?.role).toBe('assistant');
      expect(result[1]?.content).toBe('output: response a\noutput: response b');
    });

    it('should handle alternating user and assistant messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1', context: 'c1' } },
        { role: 'assistant', values: { answer: 'a1' } },
        { role: 'user', values: { question: 'q2', context: 'c2' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(4); // system, user, assistant, user
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[1]?.content).toBe('Question: q1\nContext: c1');
      expect(result[2]?.role).toBe('assistant');
      expect(result[2]?.content).toBe('answer: a1');
      expect(result[3]?.role).toBe('user');
      expect(result[3]?.content).toBe('Question: q2\nContext: c2');
    });

    it('should correctly combine mixed consecutive messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1' } },
        { role: 'user', values: { context: 'c1' } }, // Combines with previous user
        { role: 'assistant', values: { answer: 'a1' } },
        { role: 'assistant', values: { answer: 'a1 supplement' } }, // Combines with previous assistant
        { role: 'user', values: { question: 'q2' } }
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(4); // system, user, assistant, user
      expect(result[1]?.role).toBe('user');
      expect(result[1]?.content).toBe('Question: q1\nContext: c1');
      expect(result[2]?.role).toBe('assistant');
      expect(result[2]?.content).toBe('answer: a1\nanswer: a1 supplement');
      expect(result[3]?.role).toBe('user');
      expect(result[3]?.content).toBe('Question: q2');
    });

    it('should handle empty history array', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage> = [];
      const result = pt.render(history, {});
      // Expecting system prompt and potentially an empty user message or just system prompt
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.role).toBe('system');
      if (result.length === 2) { // If an empty user message is added
        expect(result[1]?.role).toBe('user');
        expect(result[1]?.content).toBe('');
      } else {
        // This case (length 1, only system prompt) is what the current code produces for empty array.
        expect(result.length).toBe(1);
      }
    });

    // TODO: Add tests for multi-modal content if that becomes relevant for history.
    // For now, the implementation stringifies/simplifies them.
  });
});
