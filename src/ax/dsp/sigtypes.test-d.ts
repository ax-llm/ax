import { describe, expectTypeOf, test } from 'vitest';
import type { ParseSignature, BuildObject } from './sigtypes.js';

describe('ParseSignature type inference', () => {
  describe('basic types', () => {
    test('should parse string types', () => {
      type Result = ParseSignature<'userQuestion:string -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should parse number types', () => {
      type Result = ParseSignature<'userInput:number -> responseScore:number'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userInput: number }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseScore: number }>();
    });

    test('should parse boolean types', () => {
      type Result = ParseSignature<'isValid:boolean -> isProcessed:boolean'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ isValid: boolean }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ isProcessed: boolean }>();
    });

    test('should default missing types to string', () => {
      type Result = ParseSignature<'userQuestion, imageData:image -> responseText'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        imageData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });
  });

  describe('array types', () => {
    test('should parse string arrays', () => {
      type Result = ParseSignature<'userQuestions:string[] -> responseTexts:string[]'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestions: string[] }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseTexts: string[] }>();
    });

    test('should parse number arrays', () => {
      type Result = ParseSignature<'inputScores:number[] -> outputScores:number[]'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ inputScores: number[] }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ outputScores: number[] }>();
    });

    test('should parse boolean arrays', () => {
      type Result = ParseSignature<'inputFlags:boolean[] -> outputFlags:boolean[]'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ inputFlags: boolean[] }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ outputFlags: boolean[] }>();
    });
  });

  describe('class types', () => {
    test('should parse class with single option', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryType: 'option1' }>();
    });

    test('should parse class with multiple options', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryType:class "positive, negative, neutral"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryType: 'positive' | 'negative' | 'neutral' }>();
    });

    test('should parse class with pipe separators', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1 | option2 | option3"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryType: 'option1' | 'option2' | 'option3' }>();
    });

    test('should parse class with mixed separators', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1, option2 | option3"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryType: 'option1' | 'option2' | 'option3' }>();
    });

    test('should parse class arrays', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryTypes:class[] "option1, option2"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryTypes: ('option1' | 'option2')[] }>();
    });
  });

  describe('multi-modal types', () => {
    test('should parse image types', () => {
      type Result = ParseSignature<'userQuestion:string, imageData:image -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        imageData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should parse audio types', () => {
      type Result = ParseSignature<'userQuestion:string, audioData:audio -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        audioData: { format?: 'wav'; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should parse file types', () => {
      type Result = ParseSignature<'userQuestion:string, fileData:file -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        fileData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should parse URL types', () => {
      type Result = ParseSignature<'websiteUrl:url -> extractedText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ websiteUrl: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ extractedText: string }>();
    });
  });

  describe('date and time types', () => {
    test('should parse date types', () => {
      type Result = ParseSignature<'startDate:date -> processedDate:date'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ startDate: Date }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ processedDate: Date }>();
    });

    test('should parse datetime types', () => {
      type Result = ParseSignature<'timestamp:datetime -> processedTime:datetime'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ timestamp: Date }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ processedTime: Date }>();
    });
  });

  describe('other types', () => {
    test('should parse JSON types', () => {
      type Result = ParseSignature<'configData:json -> resultData:json'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ configData: any }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ resultData: any }>();
    });

    test('should parse code types', () => {
      type Result = ParseSignature<'sourceCode:code -> processedCode:code'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ sourceCode: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ processedCode: string }>();
    });
  });

  describe('optional fields', () => {
    test('should parse optional input fields', () => {
      type Result = ParseSignature<'requiredField:string, optionalField?:number -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        requiredField: string; 
        optionalField?: number 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should parse optional output fields', () => {
      type Result = ParseSignature<'userQuestion:string -> requiredField:string, optionalField?:number'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        requiredField: string; 
        optionalField?: number 
      }>();
    });

    test('should parse optional fields without types', () => {
      type Result = ParseSignature<'userQuestion:string -> requiredField, optionalField?'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        requiredField: string; 
        optionalField?: string 
      }>();
    });
  });

  describe('field descriptions', () => {
    test('should handle field descriptions (ignore for type inference)', () => {
      type Result = ParseSignature<'userQuestion:string "User input" -> responseText:string "AI response"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should handle fields with descriptions but no types', () => {
      type Result = ParseSignature<'userQuestion "User input" -> responseText "AI response"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should handle class with both options and descriptions', () => {
      type Result = ParseSignature<'userQuestion:string -> categoryType:class "positive, negative" "Sentiment analysis"'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ categoryType: 'positive' | 'negative' }>();
    });
  });

  describe('complex signatures', () => {
    test('should parse multiple input and output fields', () => {
      type Result = ParseSignature<'userMessage:string, contextData:json, isUrgent:boolean -> responseText:string, confidence:number, needsFollowup:boolean'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userMessage: string; 
        contextData: any; 
        isUrgent: boolean 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        responseText: string; 
        confidence: number; 
        needsFollowup: boolean 
      }>();
    });

    test('should parse mixed types with arrays and classes', () => {
      type Result = ParseSignature<'userQuestions:string[], imageData:image -> categories:class[] "urgent, normal, low", responseTexts:string[], confidence:number'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestions: string[]; 
        imageData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        categories: ('urgent' | 'normal' | 'low')[]; 
        responseTexts: string[]; 
        confidence: number 
      }>();
    });
  });

  describe('whitespace handling', () => {
    test('should handle extra whitespace around fields', () => {
      type Result = ParseSignature<' userQuestion : string ,  imageData : image  ->  responseText : string , confidence : number '>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        imageData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        responseText: string; 
        confidence: number 
      }>();
    });

    test('should handle newlines and tabs', () => {
      type Result = ParseSignature<`
        userQuestion:string,
        imageData:image
        ->
        responseText:string,
        confidence:number
      `>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ 
        userQuestion: string; 
        imageData: { mimeType: string; data: string } 
      }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ 
        responseText: string; 
        confidence: number 
      }>();
    });
  });

  describe('edge cases', () => {
    test('should handle single input and output', () => {
      type Result = ParseSignature<'userQuestion:string -> responseText:string'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<{ userQuestion: string }>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<{ responseText: string }>();
    });

    test('should provide fallback for invalid signatures', () => {
      type Result = ParseSignature<'invalid signature format'>;
      expectTypeOf<Result['inputs']>().toEqualTypeOf<Record<string, any>>();
      expectTypeOf<Result['outputs']>().toEqualTypeOf<Record<string, any>>();
    });
  });
});

describe('BuildObject helper type', () => {
  test('should build object from field definitions', () => {
    type Fields = readonly [
      { name: 'required'; type: 'string'; optional: false },
      { name: 'optional'; type: 'number'; optional: true }
    ];
    type Result = BuildObject<Fields>;
    expectTypeOf<Result>().toEqualTypeOf<{ 
      required: string; 
      optional?: number 
    }>();
  });

  test('should handle all required fields', () => {
    type Fields = readonly [
      { name: 'field1'; type: 'string'; optional: false },
      { name: 'field2'; type: 'number'; optional: false }
    ];
    type Result = BuildObject<Fields>;
    expectTypeOf<Result>().toEqualTypeOf<{ 
      field1: string; 
      field2: number 
    }>();
  });

  test('should handle all optional fields', () => {
    type Fields = readonly [
      { name: 'field1'; type: 'string'; optional: true },
      { name: 'field2'; type: 'number'; optional: true }
    ];
    type Result = BuildObject<Fields>;
    expectTypeOf<Result>().toEqualTypeOf<{ 
      field1?: string; 
      field2?: number 
    }>();
  });
});