import { describe, expect, it } from 'vitest';

import { f } from './sig.js';

describe('AxSignatureBuilder fluent API', () => {
  it('should create signature with input and output fields', () => {
    const sig = f()
      .input('userQuestion', f.string('The question to be answered'))
      .output('answer', f.string('A concise answer to the question'))
      .build();

    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(1);
    expect(sig.getInputFields()[0].name).toBe('userQuestion');
    expect(sig.getOutputFields()[0].name).toBe('answer');
  });

  it('should create signature matching the example from requirements', () => {
    const sig = f()
      .input(
        'contextData',
        f
          .string('The factual content to base the answer on.')
          .optional()
          .array()
      )
      .input(
        'questionText',
        f.string('The question to be answered.'),
        true // prepend adds 'questionText' to the top of the input fields
      )
      .output(
        'answerText',
        f.string('A concise answer to the question, typically 1-5 words.')
      )
      .output(
        'reasonText',
        f.string('thought behind the answer'),
        true // prepend adds 'reasonText' to the top of the output fields
      )
      .description('Answers questions based on the provided context.')
      .build();

    // Verify input fields order (questionText should be first due to prepend)
    const inputs = sig.getInputFields();
    expect(inputs).toHaveLength(2);
    expect(inputs[0].name).toBe('questionText');
    expect(inputs[1].name).toBe('contextData');

    // Verify output fields order (reasonText should be first due to prepend)
    const outputs = sig.getOutputFields();
    expect(outputs).toHaveLength(2);
    expect(outputs[0].name).toBe('reasonText');
    expect(outputs[1].name).toBe('answerText');

    // Verify description
    expect(sig.getDescription()).toBe(
      'Answers questions based on the provided context.'
    );

    // Verify field properties
    expect(inputs[1].isOptional).toBe(true);
    expect(inputs[1].type?.isArray).toBe(true);
  });

  it('should support all field types', () => {
    const sig = f()
      .input('textField', f.string('A text field'))
      .input('numberField', f.number('A number field'))
      .input('booleanField', f.boolean('A boolean field'))
      .input('jsonField', f.json('A JSON field'))
      .input('dateField', f.date('A date field'))
      .input('datetimeField', f.datetime('A datetime field'))
      .input('imageField', f.image('An image field'))
      .input('audioField', f.audio('An audio field'))
      .input('fileField', f.file('A file field'))
      .input('urlField', f.url('A URL field'))
      .input('codeField', f.code('javascript', 'A code field'))
      .output(
        'classificationResult',
        f.class(['positive', 'negative', 'neutral'], 'Sentiment')
      )
      .build();

    const inputs = sig.getInputFields();
    const outputs = sig.getOutputFields();

    expect(inputs).toHaveLength(11);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].type?.name).toBe('class');
    expect(outputs[0].type?.options).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);
  });

  it('should support method chaining with type safety', () => {
    const sig = f()
      .input('userInput', f.string('User input'))
      .output('responseText', f.string('Response'))
      .description('A simple signature')
      .build();

    expect(sig.toString()).toContain('userInput:string');
    expect(sig.toString()).toContain('responseText:string');
    expect(sig.toString()).toContain('A simple signature');
  });

  it('should support optional and array modifiers', () => {
    const sig = f()
      .input('requiredField', f.string('Required field'))
      .input('optionalField', f.string('Optional field').optional())
      .input('arrayField', f.string('Array field').array())
      .input(
        'optionalArrayField',
        f.string('Optional array field').optional().array()
      )
      .output('responseText', f.string('Response'))
      .build();

    const inputs = sig.getInputFields();
    expect(inputs[0].isOptional).toBe(undefined);
    expect(inputs[1].isOptional).toBe(true);
    expect(inputs[2].type?.isArray).toBe(true);
    expect(inputs[3].isOptional).toBe(true);
    expect(inputs[3].type?.isArray).toBe(true);
  });

  it('should validate field requirements when building', () => {
    // Should throw when no input fields
    expect(() => {
      f().output('responseText', f.string('Response')).build();
    }).toThrow();

    // Should throw when no output fields
    expect(() => {
      f().input('userInput', f.string('Input')).build();
    }).toThrow();
  });
});
