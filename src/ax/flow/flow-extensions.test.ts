import { describe, expect, it } from 'vitest';

import { AxFlow } from './flow.js';
import { f } from '../dsp/template.js';

describe('AxFlow nodeExtended method', () => {
  it('should create chain-of-thought node with internal reasoning field', () => {
    const flow = new AxFlow();
    const cotFlow = flow.nodeExtended(
      'reasoner',
      'userInput:string -> answer:string',
      {
        prependOutputs: [
          {
            name: 'reasoning',
            type: f.internal(f.string('Step-by-step reasoning')),
          },
        ],
      }
    );

    const signature = cotFlow.getSignature();
    const fields = signature.getOutputFields();

    // Should have reasoning field (internal) and answer field
    expect(fields).toHaveLength(2);
    expect(fields[0]?.name).toBe('reasonerReasoning');
    expect(fields[0]?.isInternal).toBe(true);
    expect(fields[1]?.name).toBe('reasonerAnswer');

    expect(signature.toString()).toContain('reasonerReasoning!:string');
  });

  it('should create confidence-scoring node', () => {
    const flow = new AxFlow();
    const confFlow = flow.nodeExtended(
      'scorer',
      'userInput:string -> analysis:string',
      {
        appendOutputs: [
          { name: 'confidence', type: f.number('Confidence score 0-1') },
        ],
      }
    );

    const signature = confFlow.getSignature();
    const fields = signature.getOutputFields();

    expect(fields).toHaveLength(2);
    expect(fields[0]?.name).toBe('scorerAnalysis');
    expect(fields[1]?.name).toBe('scorerConfidence');
    expect(fields[1]?.type?.name).toBe('number');
  });

  it('should create contextual node with additional input fields', () => {
    const flow = new AxFlow();
    const contextFlow = flow.nodeExtended(
      'contextual',
      'question:string -> answer:string',
      {
        appendInputs: [
          { name: 'document', type: f.string('Source document') },
          {
            name: 'history',
            type: f.optional(f.array(f.string('Previous questions'))),
          },
        ],
      }
    );

    const signature = contextFlow.getSignature();
    const inputFields = signature.getInputFields();

    expect(inputFields).toHaveLength(3);
    expect(inputFields[0]?.name).toBe('contextualQuestion');
    expect(inputFields[1]?.name).toBe('contextualDocument');
    expect(inputFields[2]?.name).toBe('contextualHistory');
    expect(inputFields[2]?.isOptional).toBe(true);
  });

  it('should create extended node with all extension types', () => {
    const flow = new AxFlow();
    const extendedFlow = flow.nodeExtended(
      'analyzer',
      'userInput:string -> analysis:string',
      {
        prependInputs: [{ name: 'priority', type: f.string('Task priority') }],
        appendInputs: [
          { name: 'context', type: f.optional(f.string('Additional context')) },
        ],
        prependOutputs: [
          {
            name: 'category',
            type: f.class(['urgent', 'normal', 'low'], 'Result category'),
          },
        ],
        appendOutputs: [
          { name: 'confidence', type: f.number('Confidence score') },
        ],
      }
    );

    const signature = extendedFlow.getSignature();
    const inputFields = signature.getInputFields();
    const outputFields = signature.getOutputFields();

    // Input order: priority (prepend), userInput (original), context (append)
    expect(inputFields).toHaveLength(3);
    expect(inputFields[0]?.name).toBe('analyzerPriority');
    expect(inputFields[1]?.name).toBe('analyzerUserInput');
    expect(inputFields[2]?.name).toBe('analyzerContext');
    expect(inputFields[2]?.isOptional).toBe(true);

    // Output order: category (prepend), analysis (original), confidence (append)
    expect(outputFields).toHaveLength(3);
    expect(outputFields[0]?.name).toBe('analyzerCategory');
    expect(outputFields[0]?.type?.name).toBe('class');
    expect(outputFields[1]?.name).toBe('analyzerAnalysis');
    expect(outputFields[2]?.name).toBe('analyzerConfidence');
    expect(outputFields[2]?.type?.name).toBe('number');
  });

  it('should maintain type safety and prevent duplicate field names', () => {
    const flow = new AxFlow();

    expect(() =>
      flow.nodeExtended('test', 'userInput:string -> analysis:string', {
        appendInputs: [
          { name: 'userInput', type: f.string('Duplicate input') },
        ],
      })
    ).toThrow('Duplicate input field name');
  });

  it('should work with AxSignature instances as base', () => {
    const flow = new AxFlow();
    const baseSig = flow.getSignature(); // Get default signature

    const extendedFlow = flow.nodeExtended('thinker', baseSig, {
      prependOutputs: [
        { name: 'reasoning', type: f.internal(f.string('Reasoning')) },
      ],
    });
    const signature = extendedFlow.getSignature();

    // Should have added reasoning field
    expect(
      signature.getOutputFields().some((f) => f.name === 'thinkerReasoning')
    ).toBe(true);
  });

  it('should support method chaining', () => {
    const flow = new AxFlow();

    const chainedFlow = flow
      .nodeExtended('reasoner', 'question:string -> analysis:string', {
        prependOutputs: [
          { name: 'reasoning', type: f.internal(f.string('Reasoning')) },
        ],
      })
      .nodeExtended('scorer', 'analysis:string -> finalAnswer:string', {
        appendOutputs: [{ name: 'confidence', type: f.number('Confidence') }],
      });

    const signature = chainedFlow.getSignature();

    // Should have nodes for both extended nodes
    expect(signature.toString()).toContain('reasoner');
    expect(signature.toString()).toContain('scorer');
  });

  it('should validate field types according to input/output rules', () => {
    const flow = new AxFlow();

    // Class types not allowed in input
    expect(() =>
      flow.nodeExtended('test', 'userInput:string -> analysis:string', {
        appendInputs: [
          { name: 'category', type: f.class(['a', 'b'], 'Input category') },
        ],
      })
    ).toThrow('Class type is not supported in input fields');

    // Image types not allowed in output
    expect(() =>
      flow.nodeExtended('test', 'userInput:string -> analysis:string', {
        appendOutputs: [
          { name: 'outputImage', type: f.image('Generated image') },
        ],
      })
    ).toThrow('image type is not supported in output fields');
  });

  it('should have nx alias that works identically to nodeExtended', () => {
    const flow = new AxFlow();

    // Test nx alias with same functionality as nodeExtended
    const nxFlow = flow.nx('reasoner', 'userInput:string -> answer:string', {
      prependOutputs: [
        {
          name: 'reasoning',
          type: f.internal(f.string('Step-by-step reasoning')),
        },
      ],
    });

    const signature = nxFlow.getSignature();
    const fields = signature.getOutputFields();

    // Should have reasoning field (internal) and answer field
    expect(fields).toHaveLength(2);
    expect(fields[0]?.name).toBe('reasonerReasoning');
    expect(fields[0]?.isInternal).toBe(true);
    expect(fields[1]?.name).toBe('reasonerAnswer');

    expect(signature.toString()).toContain('reasonerReasoning!:string');
  });
});
