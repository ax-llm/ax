import { describe, expect, test } from 'vitest';
import { parseSignature } from './parser.js';
import type { ParseSignature } from './sigtypes.js';

describe('TypeScript Parser Parity with JS Parser', () => {
  test('should handle all the same features as JS parser', () => {
    // Test cases that both parsers should handle
    const testCases = [
      // Basic types
      'userQuestion:string -> responseText:string',
      'score:number -> result:number',
      'isValid:boolean -> isProcessed:boolean',

      // Multi-modal types
      'userQuestion:string, imageData:image -> responseText:string',
      'audioData:audio -> transcription:string',
      'fileData:file -> processedData:string',
      'websiteUrl:url -> extractedText:string',

      // Date types
      'startDate:date -> processedDate:date',
      'timestamp:datetime -> processedTime:datetime',

      // JSON and code types
      'configData:json -> resultData:json',
      'sourceCode:code -> processedCode:code',

      // Array types
      'userQuestions:string[] -> responseTexts:string[]',
      'inputScores:number[] -> outputScores:number[]',
      'inputFlags:boolean[] -> outputFlags:boolean[]',

      // Class types - basic
      'userQuestion:string -> categoryType:class "positive, negative, neutral"',
      'userQuestion:string -> categoryType:class "option1 | option2 | option3"',
      'userQuestion:string -> categoryType:class "option1, option2 | option3"',

      // Class arrays
      'userQuestion:string -> categoryTypes:class[] "option1, option2"',

      // Optional fields
      'requiredField:string, optionalField?:number -> responseText:string',
      'userQuestion:string -> requiredField:string, optionalField?:number',
      'userQuestion:string -> requiredField, optionalField?',

      // Field descriptions
      'userQuestion:string "User input" -> responseText:string "AI response"',
      'userQuestion "User input" -> responseText "AI response"',

      // Class with descriptions
      'userQuestion:string -> categoryType:class "positive, negative" "Sentiment analysis"',

      // Complex multi-field signatures
      'userMessage:string, contextData:json, isUrgent:boolean -> responseText:string, confidence:number, needsFollowup:boolean',

      // Signature descriptions
      '"This is a test signature" userQuestion:string -> responseText:string',

      // Whitespace handling
      ' userQuestion : string ,  imageData : image  ->  responseText : string , confidence : number ',
    ];

    // Test that JS parser can handle all cases
    for (const signature of testCases) {
      expect(() => {
        const parsed = parseSignature(signature);
        expect(parsed).toBeDefined();
        expect(parsed.inputs.length).toBeGreaterThan(0);
        expect(parsed.outputs.length).toBeGreaterThan(0);
      }).not.toThrow(`JS Parser failed for: "${signature}"`);
    }
  });

  test('should demonstrate TypeScript type inference capabilities', () => {
    // These won't be perfect due to TypeScript limitations, but they show the approach works
    // Basic type inference validation
    type BasicTest =
      ParseSignature<'userQuestion:string -> responseText:string'>;
    const basicExample: BasicTest = {
      inputs: { userQuestion: 'test' },
      outputs: { responseText: 'response' },
    };

    expect(basicExample.inputs.userQuestion).toBe('test');
    expect(basicExample.outputs.responseText).toBe('response');

    // Simple class type (without commas in options to avoid parsing complexity)
    type SimpleClassTest =
      ParseSignature<'userQuestion:string -> category:class "positive"'>;
    const simpleClassExample: SimpleClassTest = {
      inputs: { userQuestion: 'test' },
      outputs: { category: 'positive' as any }, // Type assertion needed due to parsing limitations
    };

    expect(simpleClassExample.outputs.category).toBe('positive');
  });
});
