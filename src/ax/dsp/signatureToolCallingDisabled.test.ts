import { describe, it, expect, vi } from 'vitest';
import { ax } from '../index.js';
import { createFunctionConfig } from './functions.js';
import { AxGen } from './generate.js';

// Mock function for testing
const mockFunction = {
  name: 'testFunction',
  description: 'A test function',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Test parameter' },
    },
    required: ['param1'],
  },
  func: vi.fn(),
};

describe('Signature Tool Calling - Normal Tool Calling Disabled', () => {
  describe('createFunctionConfig', () => {
    it('should return empty functions when signatureToolCalling is enabled', () => {
      const functionList = [mockFunction];

      // Without signatureToolCalling - should return functions
      const result1 = createFunctionConfig(functionList, undefined, true, {});

      expect(result1.functions).toEqual(functionList);
      expect(result1.functions.length).toBe(1);

      // With signatureToolCalling - should return empty functions
      const result2 = createFunctionConfig(functionList, undefined, true, {
        signatureToolCalling: true,
      });

      expect(result2.functions).toEqual([]);
      expect(result2.functions.length).toBe(0);
      expect(result2.functionCall).toBeUndefined();
    });

    it('should handle empty function list with signatureToolCalling', () => {
      const result = createFunctionConfig(undefined, undefined, true, {
        signatureToolCalling: true,
      });

      expect(result.functions).toEqual([]);
      expect(result.functionCall).toBeUndefined();
    });

    it('should respect other functionCall logic when signatureToolCalling is false', () => {
      const functionList = [mockFunction];

      // Test that other logic still works when signatureToolCalling is false
      const result = createFunctionConfig(
        functionList,
        'required',
        false, // firstStep = false
        { signatureToolCalling: false }
      );

      // Should still respect the firstStep + functionCall logic
      expect(result.functions).toEqual([]);
      expect(result.functionCall).toBeUndefined();
    });
  });

  describe('AxGen Integration', () => {
    it('should create SignatureToolCallingManager when signatureToolCalling is enabled', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen with signatureToolCalling enabled
      const gen = new AxGen(signature, {
        functions: [mockFunction],
        signatureToolCalling: true,
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeDefined();
      expect(manager?.isEnabled()).toBe(true);
    });

    it('should not create SignatureToolCallingManager when signatureToolCalling is disabled', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen without signatureToolCalling
      const gen = new AxGen(signature, {
        functions: [mockFunction],
        signatureToolCalling: false,
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeUndefined();
    });

    it('should not create SignatureToolCallingManager when no functions provided', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen with signatureToolCalling but no functions
      const gen = new AxGen(signature, {
        signatureToolCalling: true,
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeUndefined();
    });
  });

  describe('End-to-End Behavior', () => {
    it('should use signature tool calling and disable normal tool calling in ax function', () => {
      const signature = 'userQuestion:string -> responseText:string';

      // Create generator with signature tool calling
      const gen = ax(signature, {
        functions: [mockFunction],
        signatureToolCalling: true,
      });

      // Check that SignatureToolCallingManager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;
      expect(manager).toBeDefined();
      expect(manager?.isEnabled()).toBe(true);

      // Verify that the signature can be processed to include tool fields
      const sig = gen.getSignature();
      const processedSig = manager?.processSignature(sig);
      const outputFields = processedSig?.getOutputFields();

      // Should have the original field plus tool fields
      expect(outputFields?.some((f) => f.name === 'responseText')).toBe(true);
      expect(outputFields?.some((f) => f.name === 'test_function_param1')).toBe(
        true
      );
    });

    it('should use normal tool calling when signatureToolCalling is disabled', () => {
      const signature = 'userQuestion:string -> responseText:string';

      // Create generator without signature tool calling
      const gen = ax(signature, {
        functions: [mockFunction],
        signatureToolCalling: false,
      });

      // Check that SignatureToolCallingManager was not created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;
      expect(manager).toBeUndefined();

      // Verify that the signature was not modified with tool fields
      const sig = gen.getSignature();
      const outputFields = sig.getOutputFields();

      // Should only have the original field
      expect(outputFields.some((f) => f.name === 'responseText')).toBe(true);
      expect(outputFields.some((f) => f.name === 'test_function_param1')).toBe(
        false
      );
    });
  });

  describe('Mutual Exclusion', () => {
    it('should ensure only one tool calling method is active at a time', () => {
      const functionList = [mockFunction];

      // Test createFunctionConfig mutual exclusion
      const withSignatureCalling = createFunctionConfig(
        functionList,
        undefined,
        true,
        { signatureToolCalling: true }
      );

      const withoutSignatureCalling = createFunctionConfig(
        functionList,
        undefined,
        true,
        { signatureToolCalling: false }
      );

      // When signatureToolCalling is enabled, functions should be empty
      expect(withSignatureCalling.functions).toEqual([]);

      // When signatureToolCalling is disabled, functions should be present
      expect(withoutSignatureCalling.functions).toEqual(functionList);

      // This proves mutual exclusion at the configuration level
      expect(
        withSignatureCalling.functions.length !==
          withoutSignatureCalling.functions.length
      ).toBe(true);
    });
  });
});
