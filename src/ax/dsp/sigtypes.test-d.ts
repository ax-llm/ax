import { expectType } from 'tsd';
import type { ParseSignature, BuildObject } from './sigtypes.js';

// Test basic string types
{
  type Result = ParseSignature<'userQuestion:string -> responseText:string'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test number types
{
  type Result = ParseSignature<'userInput:number -> responseScore:number'>;
  expectType<{ userInput: number }>({} as Result['inputs']);
  expectType<{ responseScore: number }>({} as Result['outputs']);
}

// Test boolean types
{
  type Result = ParseSignature<'isValid:boolean -> isProcessed:boolean'>;
  expectType<{ isValid: boolean }>({} as Result['inputs']);
  expectType<{ isProcessed: boolean }>({} as Result['outputs']);
}

// Test default missing types to string
{
  type Result = ParseSignature<'userQuestion, imageData:image -> responseText'>;
  expectType<{ userQuestion: string; imageData: { mimeType: string; data: string } }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test string arrays
{
  type Result = ParseSignature<'userQuestions:string[] -> responseTexts:string[]'>;
  expectType<{ userQuestions: string[] }>({} as Result['inputs']);
  expectType<{ responseTexts: string[] }>({} as Result['outputs']);
}

// Test number arrays
{
  type Result = ParseSignature<'inputScores:number[] -> outputScores:number[]'>;
  expectType<{ inputScores: number[] }>({} as Result['inputs']);
  expectType<{ outputScores: number[] }>({} as Result['outputs']);
}

// Test boolean arrays
{
  type Result = ParseSignature<'inputFlags:boolean[] -> outputFlags:boolean[]'>;
  expectType<{ inputFlags: boolean[] }>({} as Result['inputs']);
  expectType<{ outputFlags: boolean[] }>({} as Result['outputs']);
}

// Test class with single option
{
  type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryType: 'option1' }>({} as Result['outputs']);
}

// Test class with multiple options
{
  type Result = ParseSignature<'userQuestion:string -> categoryType:class "positive, negative, neutral"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryType: 'positive' | 'negative' | 'neutral' }>({} as Result['outputs']);
}

// Test class with pipe separators
{
  type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1 | option2 | option3"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryType: 'option1' | 'option2' | 'option3' }>({} as Result['outputs']);
}

// Test class with mixed separators
{
  type Result = ParseSignature<'userQuestion:string -> categoryType:class "option1, option2 | option3"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryType: 'option1' | 'option2' | 'option3' }>({} as Result['outputs']);
}

// Test class arrays
{
  type Result = ParseSignature<'userQuestion:string -> categoryTypes:class[] "option1, option2"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryTypes: ('option1' | 'option2')[] }>({} as Result['outputs']);
}

// Test image types
{
  type Result = ParseSignature<'userQuestion:string, imageData:image -> responseText:string'>;
  expectType<{ userQuestion: string; imageData: { mimeType: string; data: string } }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test audio types
{
  type Result = ParseSignature<'userQuestion:string, audioData:audio -> responseText:string'>;
  expectType<{ userQuestion: string; audioData: { format?: 'wav'; data: string } }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test file types
{
  type Result = ParseSignature<'userQuestion:string, fileData:file -> responseText:string'>;
  expectType<{ userQuestion: string; fileData: { mimeType: string; data: string } }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test URL types
{
  type Result = ParseSignature<'websiteUrl:url -> extractedText:string'>;
  expectType<{ websiteUrl: string }>({} as Result['inputs']);
  expectType<{ extractedText: string }>({} as Result['outputs']);
}

// Test date types
{
  type Result = ParseSignature<'startDate:date -> processedDate:date'>;
  expectType<{ startDate: Date }>({} as Result['inputs']);
  expectType<{ processedDate: Date }>({} as Result['outputs']);
}

// Test datetime types
{
  type Result = ParseSignature<'timestamp:datetime -> processedTime:datetime'>;
  expectType<{ timestamp: Date }>({} as Result['inputs']);
  expectType<{ processedTime: Date }>({} as Result['outputs']);
}

// Test JSON types
{
  type Result = ParseSignature<'configData:json -> resultData:json'>;
  expectType<{ configData: any }>({} as Result['inputs']);
  expectType<{ resultData: any }>({} as Result['outputs']);
}

// Test code types
{
  type Result = ParseSignature<'sourceCode:code -> processedCode:code'>;
  expectType<{ sourceCode: string }>({} as Result['inputs']);
  expectType<{ processedCode: string }>({} as Result['outputs']);
}

// Test optional input fields
{
  type Result = ParseSignature<'requiredField:string, optionalField?:number -> responseText:string'>;
  expectType<{ requiredField: string; optionalField?: number }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test optional output fields
{
  type Result = ParseSignature<'userQuestion:string -> requiredField:string, optionalField?:number'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ requiredField: string; optionalField?: number }>({} as Result['outputs']);
}

// Test optional fields without types
{
  type Result = ParseSignature<'userQuestion:string -> requiredField, optionalField?'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ requiredField: string; optionalField?: string }>({} as Result['outputs']);
}

// Test field descriptions (ignore for type inference)
{
  type Result = ParseSignature<'userQuestion:string "User input" -> responseText:string "AI response"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test fields with descriptions but no types
{
  type Result = ParseSignature<'userQuestion "User input" -> responseText "AI response"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test class with both options and descriptions
{
  type Result = ParseSignature<'userQuestion:string -> categoryType:class "positive, negative" "Sentiment analysis"'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ categoryType: 'positive' | 'negative' }>({} as Result['outputs']);
}

// Test multiple input and output fields
{
  type Result = ParseSignature<'userMessage:string, contextData:json, isUrgent:boolean -> responseText:string, confidence:number, needsFollowup:boolean'>;
  expectType<{ userMessage: string; contextData: any; isUrgent: boolean }>({} as Result['inputs']);
  expectType<{ responseText: string; confidence: number; needsFollowup: boolean }>({} as Result['outputs']);
}

// Test mixed types with arrays and classes
{
  type Result = ParseSignature<'userQuestions:string[], imageData:image -> categories:class[] "urgent, normal, low", responseTexts:string[], confidence:number'>;
  expectType<{ userQuestions: string[]; imageData: { mimeType: string; data: string } }>({} as Result['inputs']);
  expectType<{ categories: ('urgent' | 'normal' | 'low')[]; responseTexts: string[]; confidence: number }>({} as Result['outputs']);
}

// Test extra whitespace around fields
{
  type Result = ParseSignature<' userQuestion : string ,  imageData : image  ->  responseText : string , confidence : number '>;
  expectType<{ userQuestion: string; imageData: { mimeType: string; data: string } }>({} as Result['inputs']);
  expectType<{ responseText: string; confidence: number }>({} as Result['outputs']);
}

// Test single input and output
{
  type Result = ParseSignature<'userQuestion:string -> responseText:string'>;
  expectType<{ userQuestion: string }>({} as Result['inputs']);
  expectType<{ responseText: string }>({} as Result['outputs']);
}

// Test fallback for invalid signatures
{
  type Result = ParseSignature<'invalid signature format'>;
  expectType<Record<string, any>>({} as Result['inputs']);
  expectType<Record<string, any>>({} as Result['outputs']);
}

// Test BuildObject helper type
{
  type Fields = readonly [
    { name: 'required'; type: 'string'; optional: false },
    { name: 'optional'; type: 'number'; optional: true },
  ];
  type Result = BuildObject<Fields>;
  expectType<{ required: string; optional?: number }>({} as Result);
}

// Test BuildObject with all required fields
{
  type Fields = readonly [
    { name: 'field1'; type: 'string'; optional: false },
    { name: 'field2'; type: 'number'; optional: false },
  ];
  type Result = BuildObject<Fields>;
  expectType<{ field1: string; field2: number }>({} as Result);
}

// Test BuildObject with all optional fields
{
  type Fields = readonly [
    { name: 'field1'; type: 'string'; optional: true },
    { name: 'field2'; type: 'number'; optional: true },
  ];
  type Result = BuildObject<Fields>;
  expectType<{ field1?: string; field2?: number }>({} as Result);
}