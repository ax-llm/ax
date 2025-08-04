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

describe('Function Call Mode - Normal Tool Calling Control', () => {
  describe('createFunctionConfig', () => {
    it('should return empty functions when functionCallMode is prompt', () => {
      const functionList = [mockFunction];

      // Without functionCallMode - should return functions
      const result1 = createFunctionConfig(functionList, undefined, true, {});

      expect(result1.functions).toEqual(functionList);
      expect(result1.functions.length).toBe(1);

      // With functionCallMode: 'prompt' - should return empty functions
      const result2 = createFunctionConfig(functionList, undefined, true, {
        functionCallMode: 'prompt',
      });

      expect(result2.functions).toEqual([]);
      expect(result2.functions.length).toBe(0);
      expect(result2.functionCall).toBeUndefined();
    });

    it('should handle empty function list with functionCallMode prompt', () => {
      const result = createFunctionConfig(undefined, undefined, true, {
        functionCallMode: 'prompt',
      });

      expect(result.functions).toEqual([]);
      expect(result.functionCall).toBeUndefined();
    });

    it('should respect other functionCall logic when functionCallMode is native', () => {
      const functionList = [mockFunction];

      // Test that other logic still works when functionCallMode is native
      const result = createFunctionConfig(
        functionList,
        'required',
        false, // firstStep = false
        { functionCallMode: 'native' }
      );

      // Should still respect the firstStep + functionCall logic
      expect(result.functions).toEqual([]);
      expect(result.functionCall).toBeUndefined();
    });
  });

  describe('AxGen Integration', () => {
    it('should create SignatureToolCallingManager when functionCallMode is set', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen with functionCallMode enabled
      const gen = new AxGen(signature, {
        functions: [mockFunction],
        functionCallMode: 'prompt',
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeDefined();
      expect(manager?.getMode()).toBe('prompt');
    });

    it('should not create SignatureToolCallingManager when functionCallMode is not set', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen without functionCallMode
      const gen = new AxGen(signature, {
        functions: [mockFunction],
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeUndefined();
    });

    it('should not create SignatureToolCallingManager when no functions provided', () => {
      const signature = 'userInput:string -> responseText:string';

      // Create AxGen with functionCallMode but no functions
      const gen = new AxGen(signature, {
        functionCallMode: 'prompt',
      });

      // Access the private property to check if manager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;

      expect(manager).toBeUndefined();
    });
  });

  describe('End-to-End Behavior', () => {
    it('should use prompt mode and disable normal tool calling in ax function', () => {
      const signature = 'userQuestion:string -> responseText:string';

      // Create generator with prompt mode
      const gen = ax(signature, {
        functions: [mockFunction],
        functionCallMode: 'prompt',
      });

      // Check that SignatureToolCallingManager was created
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;
      expect(manager).toBeDefined();
      expect(manager?.getMode()).toBe('prompt');

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

    it('should use normal tool calling when functionCallMode is native', () => {
      const signature = 'userQuestion:string -> responseText:string';

      // Create generator with native mode
      const gen = ax(signature, {
        functions: [mockFunction],
        functionCallMode: 'native',
      });

      // Check that SignatureToolCallingManager was created but not in prompt mode
      // @ts-expect-error - accessing private property for testing
      const manager = gen.signatureToolCallingManager;
      expect(manager).toBeDefined();
      expect(manager?.getMode()).toBe('native');

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
      const withPromptMode = createFunctionConfig(
        functionList,
        undefined,
        true,
        { functionCallMode: 'prompt' }
      );

      const withNativeMode = createFunctionConfig(
        functionList,
        undefined,
        true,
        { functionCallMode: 'native' }
      );

      // When functionCallMode is 'prompt', functions should be empty (prompt mode handles tools)
      expect(withPromptMode.functions).toEqual([]);

      // When functionCallMode is 'native', functions should be present (native mode uses AI's function calling)
      expect(withNativeMode.functions).toEqual(functionList);

      // This proves mutual exclusion at the configuration level
      expect(
        withPromptMode.functions.length !== withNativeMode.functions.length
      ).toBe(true);
    });
  });
});
