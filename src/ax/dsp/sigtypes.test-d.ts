import { expectType } from 'tsd';
import type { ParseSignature, BuildObject } from './sigtypes.js';

// Test basic string types
type BasicStringResult =
  ParseSignature<'userQuestion:string -> responseText:string'>;
expectType<{ userQuestion: string }>({} as BasicStringResult['inputs']);
expectType<{ responseText: string }>({} as BasicStringResult['outputs']);

// Test number types
type NumberResult = ParseSignature<'userInput:number -> responseScore:number'>;
expectType<{ userInput: number }>({} as NumberResult['inputs']);
expectType<{ responseScore: number }>({} as NumberResult['outputs']);

// Test boolean types
type BooleanResult = ParseSignature<'isValid:boolean -> isProcessed:boolean'>;
expectType<{ isValid: boolean }>({} as BooleanResult['inputs']);
expectType<{ isProcessed: boolean }>({} as BooleanResult['outputs']);

// Test default missing types to string
type DefaultStringResult =
  ParseSignature<'userQuestion, imageData:image -> responseText'>;
expectType<{
  userQuestion: string;
  imageData: { mimeType: string; data: string };
}>({} as DefaultStringResult['inputs']);
expectType<{ responseText: string }>({} as DefaultStringResult['outputs']);

// Test string arrays
type StringArrayResult =
  ParseSignature<'userQuestions:string[] -> responseTexts:string[]'>;
expectType<{ userQuestions: string[] }>({} as StringArrayResult['inputs']);
expectType<{ responseTexts: string[] }>({} as StringArrayResult['outputs']);

// Test number arrays
type NumberArrayResult =
  ParseSignature<'inputScores:number[] -> outputScores:number[]'>;
expectType<{ inputScores: number[] }>({} as NumberArrayResult['inputs']);
expectType<{ outputScores: number[] }>({} as NumberArrayResult['outputs']);

// Test boolean arrays
type BooleanArrayResult =
  ParseSignature<'inputFlags:boolean[] -> outputFlags:boolean[]'>;
expectType<{ inputFlags: boolean[] }>({} as BooleanArrayResult['inputs']);
expectType<{ outputFlags: boolean[] }>({} as BooleanArrayResult['outputs']);

// Test class with single option
type SingleClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1"'>;
expectType<{ userQuestion: string }>({} as SingleClassResult['inputs']);
expectType<{ categoryType: 'option1' }>({} as SingleClassResult['outputs']);

// Test class with multiple options
type MultipleClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "positive, negative, neutral"'>;
expectType<{ userQuestion: string }>({} as MultipleClassResult['inputs']);
expectType<{ categoryType: 'positive' | 'negative' | 'neutral' }>(
  {} as MultipleClassResult['outputs']
);

// Test class with pipe separators
type PipeClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1 | option2 | option3"'>;
expectType<{ userQuestion: string }>({} as PipeClassResult['inputs']);
expectType<{ categoryType: 'option1' | 'option2' | 'option3' }>(
  {} as PipeClassResult['outputs']
);

// Test class with mixed separators
type MixedClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1, option2 | option3"'>;
expectType<{ userQuestion: string }>({} as MixedClassResult['inputs']);
expectType<{ categoryType: 'option1' | 'option2' | 'option3' }>(
  {} as MixedClassResult['outputs']
);

// Test class arrays
type ClassArrayResult =
  ParseSignature<'userQuestion:string -> categoryTypes:class[] "option1, option2"'>;
expectType<{ userQuestion: string }>({} as ClassArrayResult['inputs']);
expectType<{ categoryTypes: ('option1' | 'option2')[] }>(
  {} as ClassArrayResult['outputs']
);

// Test image types
type ImageResult =
  ParseSignature<'userQuestion:string, imageData:image -> responseText:string'>;
expectType<{
  userQuestion: string;
  imageData: { mimeType: string; data: string };
}>({} as ImageResult['inputs']);
expectType<{ responseText: string }>({} as ImageResult['outputs']);

// Test audio types
type AudioResult =
  ParseSignature<'userQuestion:string, audioData:audio -> responseText:string'>;
expectType<{
  userQuestion: string;
  audioData: { format?: 'wav'; data: string };
}>({} as AudioResult['inputs']);
expectType<{ responseText: string }>({} as AudioResult['outputs']);

// Test file types
type FileResult =
  ParseSignature<'userQuestion:string, fileData:file -> responseText:string'>;
expectType<{
  userQuestion: string;
  fileData: { mimeType: string; data: string };
}>({} as FileResult['inputs']);
expectType<{ responseText: string }>({} as FileResult['outputs']);

// Test URL types
type URLResult = ParseSignature<'websiteUrl:url -> extractedText:string'>;
expectType<{ websiteUrl: string }>({} as URLResult['inputs']);
expectType<{ extractedText: string }>({} as URLResult['outputs']);

// Test date types
type DateResult = ParseSignature<'startDate:date -> processedDate:date'>;
expectType<{ startDate: Date }>({} as DateResult['inputs']);
expectType<{ processedDate: Date }>({} as DateResult['outputs']);

// Test datetime types
type DateTimeResult =
  ParseSignature<'timestamp:datetime -> processedTime:datetime'>;
expectType<{ timestamp: Date }>({} as DateTimeResult['inputs']);
expectType<{ processedTime: Date }>({} as DateTimeResult['outputs']);

// Test JSON types
type JSONResult = ParseSignature<'configData:json -> resultData:json'>;
expectType<{ configData: any }>({} as JSONResult['inputs']);
expectType<{ resultData: any }>({} as JSONResult['outputs']);

// Test code types
type CodeResult = ParseSignature<'sourceCode:code -> processedCode:code'>;
expectType<{ sourceCode: string }>({} as CodeResult['inputs']);
expectType<{ processedCode: string }>({} as CodeResult['outputs']);

// Test optional input fields
type OptionalInputResult =
  ParseSignature<'requiredField:string, optionalField?:number -> responseText:string'>;
expectType<{ requiredField: string; optionalField?: number }>(
  {} as OptionalInputResult['inputs']
);
expectType<{ responseText: string }>({} as OptionalInputResult['outputs']);

// Test optional output fields
type OptionalOutputResult =
  ParseSignature<'userQuestion:string -> requiredField:string, optionalField?:number'>;
expectType<{ userQuestion: string }>({} as OptionalOutputResult['inputs']);
expectType<{ requiredField: string; optionalField?: number }>(
  {} as OptionalOutputResult['outputs']
);

// Test optional fields without types
type OptionalNoTypeResult =
  ParseSignature<'userQuestion:string -> requiredField, optionalField?'>;
expectType<{ userQuestion: string }>({} as OptionalNoTypeResult['inputs']);
expectType<{ requiredField: string; optionalField?: string }>(
  {} as OptionalNoTypeResult['outputs']
);

// Test field descriptions (ignore for type inference)
type DescriptionResult =
  ParseSignature<'userQuestion:string "User input" -> responseText:string "AI response"'>;
expectType<{ userQuestion: string }>({} as DescriptionResult['inputs']);
expectType<{ responseText: string }>({} as DescriptionResult['outputs']);

// Test fields with descriptions but no types
type DescriptionNoTypeResult =
  ParseSignature<'userQuestion "User input" -> responseText "AI response"'>;
expectType<{ userQuestion: string }>({} as DescriptionNoTypeResult['inputs']);
expectType<{ responseText: string }>({} as DescriptionNoTypeResult['outputs']);

// Test class with both options and descriptions
type ClassDescriptionResult =
  ParseSignature<'userQuestion:string -> categoryType:class "positive, negative" "Sentiment analysis"'>;
expectType<{ userQuestion: string }>({} as ClassDescriptionResult['inputs']);
expectType<{ categoryType: 'positive' | 'negative' }>(
  {} as ClassDescriptionResult['outputs']
);

// Test multiple input and output fields
type MultipleFieldsResult =
  ParseSignature<'userMessage:string, contextData:json, isUrgent:boolean -> responseText:string, confidence:number, needsFollowup:boolean'>;
expectType<{ userMessage: string; contextData: any; isUrgent: boolean }>(
  {} as MultipleFieldsResult['inputs']
);
expectType<{
  responseText: string;
  confidence: number;
  needsFollowup: boolean;
}>({} as MultipleFieldsResult['outputs']);

// Test mixed types with arrays and classes
type MixedTypesResult =
  ParseSignature<'userQuestions:string[], imageData:image -> categories:class[] "urgent, normal, low", responseTexts:string[], confidence:number'>;
expectType<{
  userQuestions: string[];
  imageData: { mimeType: string; data: string };
}>({} as MixedTypesResult['inputs']);
expectType<{
  categories: ('urgent' | 'normal' | 'low')[];
  responseTexts: string[];
  confidence: number;
}>({} as MixedTypesResult['outputs']);

// Test extra whitespace around fields
type WhitespaceResult =
  ParseSignature<' userQuestion : string ,  imageData : image  ->  responseText : string , confidence : number '>;
expectType<{
  userQuestion: string;
  imageData: { mimeType: string; data: string };
}>({} as WhitespaceResult['inputs']);
expectType<{ responseText: string; confidence: number }>(
  {} as WhitespaceResult['outputs']
);

// Test single input and output
type SingleFieldResult =
  ParseSignature<'userQuestion:string -> responseText:string'>;
expectType<{ userQuestion: string }>({} as SingleFieldResult['inputs']);
expectType<{ responseText: string }>({} as SingleFieldResult['outputs']);

// Test fallback for invalid signatures
type InvalidResult = ParseSignature<'invalid signature format'>;
expectType<Record<string, any>>({} as InvalidResult['inputs']);
expectType<Record<string, any>>({} as InvalidResult['outputs']);

// Test BuildObject helper type
type TestFields = readonly [
  { name: 'required'; type: 'string'; optional: false },
  { name: 'optional'; type: 'number'; optional: true },
];
type BuildObjectResult = BuildObject<TestFields>;
expectType<{ required: string; optional?: number }>({} as BuildObjectResult);

// Test BuildObject with all required fields
type AllRequiredFields = readonly [
  { name: 'field1'; type: 'string'; optional: false },
  { name: 'field2'; type: 'number'; optional: false },
];
type AllRequiredResult = BuildObject<AllRequiredFields>;
expectType<{ field1: string; field2: number }>({} as AllRequiredResult);

// Test BuildObject with all optional fields
type AllOptionalFields = readonly [
  { name: 'field1'; type: 'string'; optional: true },
  { name: 'field2'; type: 'number'; optional: true },
];
type AllOptionalResult = BuildObject<AllOptionalFields>;
expectType<{ field1?: string; field2?: number }>({} as AllOptionalResult);
