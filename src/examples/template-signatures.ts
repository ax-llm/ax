import { AxAI, AxChainOfThought, f, s } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

console.log('=== Tagged Template Literals for AxSignatures ===\n');

// Example 1: Basic tagged template signature
console.log('1. Basic tagged template signature:');
const basicSig = s`userQuestion:string -> responseText:string`;
console.log('Signature:', basicSig.toString());
console.log(
  'Input fields:',
  basicSig.getInputFields().map((f) => f.name)
);
console.log(
  'Output fields:',
  basicSig.getOutputFields().map((f) => f.name)
);
console.log();

// Example 2: Using field builders for type-safe field creation
console.log('2. Using field builders:');
const sentimentSig = s`
  inputText:${f.string('Text to analyze')} -> 
  sentimentCategory:${f.class(['positive', 'negative', 'neutral'], 'Sentiment classification')},
  confidenceScore:${f.number('Confidence score 0-1')}
`;
console.log('Signature:', sentimentSig.toString());
console.log(
  'Sentiment field options:',
  sentimentSig.getOutputFields()[0]?.type?.options
);
console.log();

// Example 3: Complex multi-field signature with arrays and modifiers
console.log('3. Complex signature with arrays and modifiers:');
const complexSig = s`
  "Extract structured information from customer feedback"
  customerFeedback:${f.string('Customer feedback text')} ->
  extractedTopics:${f.array(f.string())},
  urgencyLevel:${f.class(['low', 'medium', 'high'])},
  actionItems:${f.array(f.string())},
  internalReasoning:${f.internal(f.string('Internal reasoning process'))},
  followUpRequired:${f.optional(f.boolean('Whether follow-up is needed'))}
`;
console.log('Signature:', complexSig.toString());
console.log('Description:', complexSig.getDescription());
console.log(
  'Extracted topics field is array:',
  complexSig.getOutputFields()[0]?.type?.isArray
);
console.log(
  'Internal reasoning field is internal:',
  complexSig.getOutputFields()[3]?.isInternal
);
console.log(
  'Follow-up field is optional:',
  complexSig.getOutputFields()[4]?.isOptional
);
console.log();

// Example 4: Using with AxChainOfThought
console.log('4. Using tagged template with AxChainOfThought:');
const cot = new AxChainOfThought(s`
  contextInfo:${f.array(f.string('Context information'))},
  userQuestion:${f.string('Question to answer')} ->
  detailedAnswer:${f.string('Detailed answer')},
  sourceReferences:${f.array(f.string('Source references'))}
`);

const cotResult = await cot.forward(ai, {
  contextInfo: [
    'Paris is the capital of France and its largest city.',
    'France is located in Western Europe.',
    'The Seine River flows through Paris.',
  ],
  userQuestion:
    'What is the capital of France and what river flows through it?',
});

console.log('Chain of Thought Result:');
console.log('Answer:', cotResult.detailedAnswer);
console.log('Sources:', cotResult.sourceReferences);
console.log();

// Example 5: Code generation signature
console.log('5. Code generation signature:');
const codeSig = s`
  problemDescription:${f.string('Programming problem description')} ->
  pythonSolution:${f.code('python', 'Python code solution')},
  solutionExplanation:${f.string('Explanation of the solution')},
  timeComplexity:${f.class(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)'], 'Time complexity')}
`;
console.log('Signature:', codeSig.toString());
console.log(
  'Python solution field type:',
  codeSig.getOutputFields()[0]?.type?.name
);
console.log(
  'Python solution field language:',
  codeSig.getOutputFields()[0]?.type?.options?.[0]
);
console.log();

// Example 6: Date and datetime fields
console.log('6. Date and datetime fields:');
const eventSig = s`
  eventDescription:${f.string('Event description')} ->
  scheduledDate:${f.date('Event date')},
  createdTimestamp:${f.datetime('Creation timestamp')},
  isRecurringEvent:${f.boolean('Whether event repeats')}
`;
console.log('Signature:', eventSig.toString());
console.log();

// Example 7: JSON field for structured data
console.log('7. JSON field for structured data:');
const jsonSig = s`
  rawInputData:${f.string('Raw input data')} ->
  structuredOutput:${f.json('Structured JSON output')},
  isValidData:${f.boolean('Whether data is valid')}
`;
console.log('Signature:', jsonSig.toString());
console.log();

// Example 8: Chaining field modifiers
console.log('8. Chaining field modifiers:');
const chainedSig = s`
  inputText:${f.string('Input text')} ->
  primaryResults:${f.array(f.string('Main results'))},
  secondaryResults:${f.optional(f.array(f.string('Optional secondary results')))},
  debugInformation:${f.internal(f.optional(f.json('Internal debug information')))}
`;
console.log('Signature:', chainedSig.toString());
console.log(
  'Secondary results - optional array:',
  chainedSig.getOutputFields()[1]?.isOptional &&
    chainedSig.getOutputFields()[1]?.type?.isArray
);
console.log(
  'Debug information - internal optional JSON:',
  chainedSig.getOutputFields()[2]?.isInternal &&
    chainedSig.getOutputFields()[2]?.isOptional &&
    chainedSig.getOutputFields()[2]?.type?.name === 'json'
);
console.log();

// Example 9: Comparison with string-based signature
console.log('9. Comparison with traditional string signature:');
const stringSig =
  'userQuestion:string -> responseText:string, confidenceScore:number';
const templateSig = s`userQuestion:string -> responseText:string, confidenceScore:number`;

console.log('String signature:', stringSig);
console.log('Template signature:', templateSig.toString());
console.log('Are equivalent:', stringSig === templateSig.toString());
console.log();

console.log('=== Tagged Template Literals Demo Complete ===');
