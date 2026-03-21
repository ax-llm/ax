import { describe, expect, it } from 'vitest';

import { AxPromptTemplate } from './prompt.js';
import { AxSignature, f } from './sig.js';

describe('AxPromptTemplate - Structured Prompts', () => {
  describe('XML structure', () => {
    it('should generate XML-structured prompt', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt).toBeDefined();
      expect(systemPrompt?.content).toContain('<identity>');
      expect(systemPrompt?.content).toContain('</identity>');
      expect(systemPrompt?.content).toContain('<input_fields>');
      expect(systemPrompt?.content).toContain('</input_fields>');
      expect(systemPrompt?.content).toContain('<output_fields>');
      expect(systemPrompt?.content).toContain('</output_fields>');
      expect(systemPrompt?.content).toContain('<formatting_rules>');
      expect(systemPrompt?.content).toContain('</formatting_rules>');
    });

    it('should use structured format by default', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt).toBeDefined();
      expect(systemPrompt?.content).toContain('<identity>');
    });
  });

  describe('Format protection', () => {
    it('should include mandatory formatting statement for plain-text outputs', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain(
        'These rules are mandatory and override later instructions.'
      );
      expect(systemPrompt?.content).toContain(
        'Return one `field name: value` pair per line'
      );
    });

    it('should include mandatory formatting statement for structured outputs', () => {
      const sig = f()
        .input('userInput', f.string())
        .output(
          'analysisResult',
          f.object({
            message: f.string(),
            confidence: f.number(),
          })
        )
        .build();

      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain(
        'These rules are mandatory and override later instructions.'
      );
      expect(systemPrompt?.content).toContain(
        'Return valid JSON matching <output_fields>.'
      );
    });
  });

  describe('Structured vs plain-text mode detection', () => {
    it('should detect structured output mode for object fields', () => {
      const sig = f()
        .input('userInput', f.string())
        .output(
          'analysisResult',
          f.object({
            message: f.string(),
          })
        )
        .build();

      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('valid JSON');
      expect(systemPrompt?.content).not.toContain('field name: value');
    });

    it('should detect plain-text mode for simple fields', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('field name: value');
      expect(systemPrompt?.content).not.toContain('valid JSON');
    });

    it('should detect structured output mode for array of objects', () => {
      const sig = f()
        .input('userInput', f.string())
        .output(
          'items',
          f
            .object({
              name: f.string(),
              value: f.number(),
            })
            .array()
        )
        .build();

      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('valid JSON');
    });
  });

  describe('Functions section', () => {
    it('should include functions section when functions are provided', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig, {
        functions: [
          {
            name: 'searchDatabase',
            description: 'Search the database for information',
            parameters: {
              type: 'object' as const,
              properties: {
                query: { type: 'string' as const },
              },
              required: ['query'],
            },
          },
        ],
      });

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('<available_functions>');
      expect(systemPrompt?.content).toContain('</available_functions>');
      expect(systemPrompt?.content).toContain('searchDatabase');
      expect(systemPrompt?.content).toContain(
        'Search the database for information'
      );
    });

    it('should not include functions section when no functions provided', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).not.toContain('<available_functions>');
    });
  });

  describe('Description handling', () => {
    it('should include signature description in task_definition section', () => {
      const sig = AxSignature.create(
        '"Analyze sentiment" userInput:string -> sentiment:string'
      );
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('Analyze sentiment');
      expect(systemPrompt?.content).toContain('<task_definition>');
      expect(systemPrompt?.content).toContain('</task_definition>');
    });

    it('should omit task_definition section when signature has no description', () => {
      const sig = AxSignature.create('userInput:string -> aiResponse:string');
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).not.toContain('<task_definition>');
      expect(systemPrompt?.content).toContain('<identity>');
    });
  });

  describe('Template-backed structured prompt regression coverage', () => {
    it('renders the structured system prompt with functions and description in the prior order', () => {
      const sig = AxSignature.create(
        '"Analyze sentiment" userInput:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(sig, {
        functions: [
          {
            name: 'searchDatabase',
            description: 'Search the database for information',
            parameters: {
              type: 'object' as const,
              properties: {
                query: { type: 'string' as const },
              },
              required: ['query'],
            },
          },
        ],
      });

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain('<identity>');
      expect(systemPrompt?.content).toContain('</identity>');
      expect(systemPrompt?.content).toContain('<task_definition>');
      expect(systemPrompt?.content).toContain('Analyze sentiment.');
      expect(systemPrompt?.content).toContain('<available_functions>');
      expect(systemPrompt?.content).toContain('searchDatabase');
      expect(systemPrompt?.content).toContain('## Function Call Instructions');
      expect(systemPrompt?.content).toContain('<input_fields>');
      expect(systemPrompt?.content).toContain('<output_fields>');
      expect(systemPrompt?.content).toContain('<formatting_rules>');

      expect(
        systemPrompt?.content.indexOf('<available_functions>')
      ).toBeGreaterThan(systemPrompt?.content.indexOf('</identity>') ?? -1);
      expect(systemPrompt?.content.indexOf('<input_fields>')).toBeGreaterThan(
        systemPrompt?.content.indexOf('</available_functions>') ?? -1
      );
      expect(systemPrompt?.content.indexOf('<output_fields>')).toBeGreaterThan(
        systemPrompt?.content.indexOf('</input_fields>') ?? -1
      );
      expect(
        systemPrompt?.content.indexOf('<formatting_rules>')
      ).toBeGreaterThan(
        systemPrompt?.content.indexOf('</output_fields>') ?? -1
      );
      expect(
        systemPrompt?.content.indexOf('<task_definition>')
      ).toBeGreaterThan(
        systemPrompt?.content.indexOf('</formatting_rules>') ?? -1
      );
    });

    it('uses structured function-call formatting rules for complex output fallback', () => {
      const sig = f()
        .input('userInput', f.string())
        .output(
          'analysisResult',
          f.object({
            message: f.string(),
          })
        )
        .build();
      const template = new AxPromptTemplate(sig, {
        structuredOutputFunctionName: 'submitStructuredOutput',
      });

      const messages = template.render({ userInput: 'test' }, {});
      const systemPrompt = messages.find((m) => m.role === 'system');

      expect(systemPrompt?.content).toContain(
        'Return the complete output by calling `submitStructuredOutput`.'
      );
      expect(systemPrompt?.content).toContain(
        'Do not emit any text outside the function call.'
      );
      expect(systemPrompt?.content).not.toContain('<output_fields>');
    });
  });
});
