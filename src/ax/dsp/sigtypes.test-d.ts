// Compile-time tests for ParseSignature/BuildObject inference, enforced by
// `npm run test:type-tests` (tsc -p tsconfig.typetests.json). Equal compares
// exact shapes (including optionality); Flatten normalizes the mapped-type
// intersections BuildObject produces so they can be compared against plain
// object literals.
import type { AxAudioInput, AxChatAudioOutput } from '../ai/types.js';
import type { Equal, Expect, Flatten } from '../util/typetest.js';
import type { BuildObject, ParseSignature } from './sigtypes.js';

// Basic string types
type BasicStringResult =
  ParseSignature<'userQuestion:string -> responseText:string'>;
type _basicIn = Expect<
  Equal<Flatten<BasicStringResult['inputs']>, { userQuestion: string }>
>;
type _basicOut = Expect<
  Equal<Flatten<BasicStringResult['outputs']>, { responseText: string }>
>;

// Number types
type NumberResult = ParseSignature<'userInput:number -> responseScore:number'>;
type _numberIn = Expect<
  Equal<Flatten<NumberResult['inputs']>, { userInput: number }>
>;
type _numberOut = Expect<
  Equal<Flatten<NumberResult['outputs']>, { responseScore: number }>
>;

// Boolean types
type BooleanResult = ParseSignature<'isValid:boolean -> isProcessed:boolean'>;
type _booleanIn = Expect<
  Equal<Flatten<BooleanResult['inputs']>, { isValid: boolean }>
>;
type _booleanOut = Expect<
  Equal<Flatten<BooleanResult['outputs']>, { isProcessed: boolean }>
>;

// Missing types default to string
type DefaultStringResult =
  ParseSignature<'userQuestion, imageData:image -> responseText'>;
type _defaultIn = Expect<
  Equal<
    Flatten<DefaultStringResult['inputs']>,
    { userQuestion: string; imageData: { mimeType: string; data: string } }
  >
>;
type _defaultOut = Expect<
  Equal<Flatten<DefaultStringResult['outputs']>, { responseText: string }>
>;

// String arrays
type StringArrayResult =
  ParseSignature<'userQuestions:string[] -> responseTexts:string[]'>;
type _stringArrayIn = Expect<
  Equal<Flatten<StringArrayResult['inputs']>, { userQuestions: string[] }>
>;
type _stringArrayOut = Expect<
  Equal<Flatten<StringArrayResult['outputs']>, { responseTexts: string[] }>
>;

// Number arrays
type NumberArrayResult =
  ParseSignature<'inputScores:number[] -> outputScores:number[]'>;
type _numberArrayIn = Expect<
  Equal<Flatten<NumberArrayResult['inputs']>, { inputScores: number[] }>
>;
type _numberArrayOut = Expect<
  Equal<Flatten<NumberArrayResult['outputs']>, { outputScores: number[] }>
>;

// Boolean arrays
type BooleanArrayResult =
  ParseSignature<'inputFlags:boolean[] -> outputFlags:boolean[]'>;
type _booleanArrayIn = Expect<
  Equal<Flatten<BooleanArrayResult['inputs']>, { inputFlags: boolean[] }>
>;
type _booleanArrayOut = Expect<
  Equal<Flatten<BooleanArrayResult['outputs']>, { outputFlags: boolean[] }>
>;

// Class with a single option
type SingleClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1"'>;
type _singleClassOut = Expect<
  Equal<Flatten<SingleClassResult['outputs']>, { categoryType: 'option1' }>
>;

// Class with multiple options
type MultipleClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "positive, negative, neutral"'>;
type _multipleClassOut = Expect<
  Equal<
    Flatten<MultipleClassResult['outputs']>,
    { categoryType: 'positive' | 'negative' | 'neutral' }
  >
>;

// Class with pipe separators
type PipeClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1 | option2 | option3"'>;
type _pipeClassOut = Expect<
  Equal<
    Flatten<PipeClassResult['outputs']>,
    { categoryType: 'option1' | 'option2' | 'option3' }
  >
>;

// Class with mixed separators
type MixedClassResult =
  ParseSignature<'userQuestion:string -> categoryType:class "option1, option2 | option3"'>;
type _mixedClassOut = Expect<
  Equal<
    Flatten<MixedClassResult['outputs']>,
    { categoryType: 'option1' | 'option2' | 'option3' }
  >
>;

// Class arrays
type ClassArrayResult =
  ParseSignature<'userQuestion:string -> categoryTypes:class[] "option1, option2"'>;
type _classArrayOut = Expect<
  Equal<
    Flatten<ClassArrayResult['outputs']>,
    { categoryTypes: ('option1' | 'option2')[] }
  >
>;

// Image inputs
type ImageResult =
  ParseSignature<'userQuestion:string, imageData:image -> responseText:string'>;
type _imageIn = Expect<
  Equal<
    Flatten<ImageResult['inputs']>,
    { userQuestion: string; imageData: { mimeType: string; data: string } }
  >
>;

// Audio inputs
type AudioResult =
  ParseSignature<'userQuestion:string, audioData:audio -> responseText:string'>;
type _audioIn = Expect<
  Equal<
    Flatten<AudioResult['inputs']>,
    { userQuestion: string; audioData: AxAudioInput }
  >
>;

// Audio outputs use synthesized audio artifacts
type AudioOutputResult =
  ParseSignature<'userQuestion:string -> speech:audio, summary:string'>;
type _audioOut = Expect<
  Equal<
    Flatten<AudioOutputResult['outputs']>,
    { speech: AxChatAudioOutput; summary: string }
  >
>;

// File inputs
type FileResult =
  ParseSignature<'userQuestion:string, fileData:file -> responseText:string'>;
type _fileIn = Expect<
  Equal<
    Flatten<FileResult['inputs']>,
    {
      userQuestion: string;
      fileData:
        | { mimeType: string; data: string }
        | { mimeType: string; fileUri: string };
    }
  >
>;

// URL types map to string
type URLResult = ParseSignature<'websiteUrl:url -> extractedText:string'>;
type _urlIn = Expect<
  Equal<Flatten<URLResult['inputs']>, { websiteUrl: string }>
>;

// Date types map to Date
type DateResult = ParseSignature<'startDate:date -> processedDate:date'>;
type _dateIn = Expect<
  Equal<Flatten<DateResult['inputs']>, { startDate: Date }>
>;
type _dateOut = Expect<
  Equal<Flatten<DateResult['outputs']>, { processedDate: Date }>
>;

// Datetime types map to Date
type DateTimeResult =
  ParseSignature<'timestamp:datetime -> processedTime:datetime'>;
type _dateTimeIn = Expect<
  Equal<Flatten<DateTimeResult['inputs']>, { timestamp: Date }>
>;
type _dateTimeOut = Expect<
  Equal<Flatten<DateTimeResult['outputs']>, { processedTime: Date }>
>;

// Range types map to { start; end }
type DateRangeResult =
  ParseSignature<'travelDates:dateRange -> processedDates:dateRange'>;
type _dateRangeIn = Expect<
  Equal<
    Flatten<DateRangeResult['inputs']>,
    { travelDates: { start: Date; end: Date } }
  >
>;
type _dateRangeOut = Expect<
  Equal<
    Flatten<DateRangeResult['outputs']>,
    { processedDates: { start: Date; end: Date } }
  >
>;

type DateTimeRangeResult =
  ParseSignature<'availability:datetimeRange -> selectedWindow:datetimeRange'>;
type _dateTimeRangeIn = Expect<
  Equal<
    Flatten<DateTimeRangeResult['inputs']>,
    { availability: { start: Date; end: Date } }
  >
>;
type _dateTimeRangeOut = Expect<
  Equal<
    Flatten<DateTimeRangeResult['outputs']>,
    { selectedWindow: { start: Date; end: Date } }
  >
>;

// JSON types map to any
type JSONResult = ParseSignature<'configData:json -> resultData:json'>;
type _jsonIn = Expect<
  Equal<Flatten<JSONResult['inputs']>, { configData: any }>
>;
type _jsonOut = Expect<
  Equal<Flatten<JSONResult['outputs']>, { resultData: any }>
>;

// Code types map to string
type CodeResult = ParseSignature<'sourceCode:code -> processedCode:code'>;
type _codeIn = Expect<
  Equal<Flatten<CodeResult['inputs']>, { sourceCode: string }>
>;
type _codeOut = Expect<
  Equal<Flatten<CodeResult['outputs']>, { processedCode: string }>
>;

// Optional input fields
type OptionalInputResult =
  ParseSignature<'requiredField:string, optionalField?:number -> responseText:string'>;
type _optionalIn = Expect<
  Equal<
    Flatten<OptionalInputResult['inputs']>,
    { requiredField: string; optionalField?: number }
  >
>;

// Optional output fields
type OptionalOutputResult =
  ParseSignature<'userQuestion:string -> requiredField:string, optionalField?:number'>;
type _optionalOut = Expect<
  Equal<
    Flatten<OptionalOutputResult['outputs']>,
    { requiredField: string; optionalField?: number }
  >
>;

// Optional fields without types default to string
type OptionalNoTypeResult =
  ParseSignature<'userQuestion:string -> requiredField, optionalField?'>;
type _optionalNoTypeOut = Expect<
  Equal<
    Flatten<OptionalNoTypeResult['outputs']>,
    { requiredField: string; optionalField?: string }
  >
>;

// Field descriptions are ignored for type inference
type DescriptionResult =
  ParseSignature<'userQuestion:string "User input" -> responseText:string "AI response"'>;
type _descriptionIn = Expect<
  Equal<Flatten<DescriptionResult['inputs']>, { userQuestion: string }>
>;
type _descriptionOut = Expect<
  Equal<Flatten<DescriptionResult['outputs']>, { responseText: string }>
>;

// Descriptions without types
type DescriptionNoTypeResult =
  ParseSignature<'userQuestion "User input" -> responseText "AI response"'>;
type _descriptionNoTypeIn = Expect<
  Equal<Flatten<DescriptionNoTypeResult['inputs']>, { userQuestion: string }>
>;
type _descriptionNoTypeOut = Expect<
  Equal<Flatten<DescriptionNoTypeResult['outputs']>, { responseText: string }>
>;

// Class with both options and a description
type ClassDescriptionResult =
  ParseSignature<'userQuestion:string -> categoryType:class "positive, negative" "Sentiment analysis"'>;
type _classDescriptionOut = Expect<
  Equal<
    Flatten<ClassDescriptionResult['outputs']>,
    { categoryType: 'positive' | 'negative' }
  >
>;

// Multiple input and output fields
type MultipleFieldsResult =
  ParseSignature<'userMessage:string, contextData:json, isUrgent:boolean -> responseText:string, confidence:number, needsFollowup:boolean'>;
type _multipleIn = Expect<
  Equal<
    Flatten<MultipleFieldsResult['inputs']>,
    { userMessage: string; contextData: any; isUrgent: boolean }
  >
>;
type _multipleOut = Expect<
  Equal<
    Flatten<MultipleFieldsResult['outputs']>,
    { responseText: string; confidence: number; needsFollowup: boolean }
  >
>;

// Mixed types with arrays and classes
type MixedTypesResult =
  ParseSignature<'userQuestions:string[], imageData:image -> categories:class[] "urgent, normal, low", responseTexts:string[], confidence:number'>;
type _mixedIn = Expect<
  Equal<
    Flatten<MixedTypesResult['inputs']>,
    { userQuestions: string[]; imageData: { mimeType: string; data: string } }
  >
>;
type _mixedOut = Expect<
  Equal<
    Flatten<MixedTypesResult['outputs']>,
    {
      categories: ('urgent' | 'normal' | 'low')[];
      responseTexts: string[];
      confidence: number;
    }
  >
>;

// Extra whitespace around fields is tolerated
type WhitespaceResult =
  ParseSignature<' userQuestion : string ,  imageData : image  ->  responseText : string , confidence : number '>;
type _whitespaceIn = Expect<
  Equal<
    Flatten<WhitespaceResult['inputs']>,
    { userQuestion: string; imageData: { mimeType: string; data: string } }
  >
>;
type _whitespaceOut = Expect<
  Equal<
    Flatten<WhitespaceResult['outputs']>,
    { responseText: string; confidence: number }
  >
>;

// Invalid signatures fall back to the permissive shape
type InvalidResult = ParseSignature<'invalid signature format'>;
type _invalidIn = Expect<Equal<InvalidResult['inputs'], Record<string, any>>>;
type _invalidOut = Expect<Equal<InvalidResult['outputs'], Record<string, any>>>;

// BuildObject helper with mixed optionality
type TestFields = readonly [
  { name: 'required'; type: 'string'; optional: false },
  { name: 'optional'; type: 'number'; optional: true },
];
type _buildObject = Expect<
  Equal<
    Flatten<BuildObject<TestFields>>,
    { required: string; optional?: number }
  >
>;

// BuildObject with all required fields
type AllRequiredFields = readonly [
  { name: 'field1'; type: 'string'; optional: false },
  { name: 'field2'; type: 'number'; optional: false },
];
type _buildObjectRequired = Expect<
  Equal<
    Flatten<BuildObject<AllRequiredFields>>,
    { field1: string; field2: number }
  >
>;

// BuildObject with all optional fields
type AllOptionalFields = readonly [
  { name: 'field1'; type: 'string'; optional: true },
  { name: 'field2'; type: 'number'; optional: true },
];
type _buildObjectOptional = Expect<
  Equal<
    Flatten<BuildObject<AllOptionalFields>>,
    { field1?: string; field2?: number }
  >
>;

// Negative control: a wrong expectation must fail to compile. The Equal is
// computed on its own line so the Expect witness stays single-line and the
// suppressed error lands directly under the directive.
type _negativeCheck = Equal<
  Flatten<NumberResult['outputs']>,
  { responseScore: string }
>;
// @ts-expect-error responseScore is a number, not a string
type _negative = Expect<_negativeCheck>;
type _negativeIsUsed = _negative | never;
