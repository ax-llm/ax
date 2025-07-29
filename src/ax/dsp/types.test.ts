import { describe, it, expect } from 'vitest';
import type { ParseSignature } from './types.js';

describe('ParseSignature TypeScript type inference', () => {
  it('should handle fields with descriptions but no explicit types', () => {
    // Test the exact case that was broken
    type TestSig = 'searchQuery:string -> relevantContext "description", sources:string "desc"';
    type ParsedResult = ParseSignature<TestSig>;
    
    // This should compile without errors
    const testObj: ParsedResult = {
      inputs: {
        searchQuery: 'test'
      },
      outputs: {
        relevantContext: 'test', // This field should exist with string type
        sources: 'test'
      }
    };
    
    expect(testObj).toBeDefined();
  });

  it('should handle minimal fields without types', () => {
    type MinimalSig = 'input -> output';
    type ParsedMinimal = ParseSignature<MinimalSig>;
    
    const minimalObj: ParsedMinimal = {
      inputs: { input: 'test' },
      outputs: { output: 'test' }
    };
    
    expect(minimalObj).toBeDefined();
  });

  it('should handle fields with descriptions and no colon', () => {
    type DescSig = 'input "input desc" -> output "output desc"';
    type ParsedDesc = ParseSignature<DescSig>;
    
    const descObj: ParsedDesc = {
      inputs: { input: 'test' },
      outputs: { output: 'test' }
    };
    
    expect(descObj).toBeDefined();
  });

  it('should handle mixed explicit and implicit types', () => {
    type MixedSig = 'input:string -> output1 "desc", output2:number "desc"';
    type ParsedMixed = ParseSignature<MixedSig>;
    
    const mixedObj: ParsedMixed = {
      inputs: { input: 'test' },
      outputs: { 
        output1: 'test', // should default to string
        output2: 42      // should be number
      }
    };
    
    expect(mixedObj).toBeDefined();
  });

  it('should handle class types with options as union types', () => {
    type ClassSig = 'input:string -> sourceType:class "class1, class2, class3"';
    type ParsedClass = ParseSignature<ClassSig>;
    
    const classObj1: ParsedClass = {
      inputs: { input: 'test' },
      outputs: { sourceType: 'class1' } // Should be 'class1' | 'class2' | 'class3'
    };
    
    const classObj2: ParsedClass = {
      inputs: { input: 'test' },
      outputs: { sourceType: 'class2' } // Should also be valid
    };
    
    expect(classObj1).toBeDefined();
    expect(classObj2).toBeDefined();
  });

  it('should handle class arrays', () => {
    type ClassArraySig = 'input:string -> categories:class[] "cat1, cat2"';
    type ParsedClassArray = ParseSignature<ClassArraySig>;
    
    const classArrayObj: ParsedClassArray = {
      inputs: { input: 'test' },
      outputs: { categories: ['cat1', 'cat2'] } // Should be ('cat1' | 'cat2')[]
    };
    
    expect(classArrayObj).toBeDefined();
  });

  it('should handle the original problematic signature', () => {
    type OriginalSig = 'searchQuery:string -> sourceType:class "class1, class2, class3", relevantContext "context", sources:string';
    type ParsedOriginal = ParseSignature<OriginalSig>;
    
    const originalObj: ParsedOriginal = {
      inputs: { searchQuery: 'test' },
      outputs: { 
        sourceType: 'class1', // Should be union type
        relevantContext: 'test', // Should default to string
        sources: 'test' // Should be string
      }
    };
    
    expect(originalObj).toBeDefined();
  });
});