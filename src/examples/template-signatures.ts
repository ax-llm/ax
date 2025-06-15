import { ax, AxAI, AxChainOfThought, axField } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

console.log('=== Tagged Template Literals for AxSignatures ===\n')

// Example 1: Basic tagged template signature
console.log('1. Basic tagged template signature:')
const basicSig = ax`question:string -> answer:string`
console.log('Signature:', basicSig.toString())
console.log(
  'Input fields:',
  basicSig.getInputFields().map((f) => f.name)
)
console.log(
  'Output fields:',
  basicSig.getOutputFields().map((f) => f.name)
)
console.log()

// Example 2: Using field builders for type-safe field creation
console.log('2. Using field builders:')
const sentimentSig = ax`
  text:${axField.string('Text to analyze')} -> 
  sentiment:${axField.class(['positive', 'negative', 'neutral'], 'Sentiment classification')},
  confidence:${axField.number('Confidence score 0-1')}
`
console.log('Signature:', sentimentSig.toString())
console.log(
  'Sentiment field options:',
  sentimentSig.getOutputFields()[0]?.type?.options
)
console.log()

// Example 3: Complex multi-field signature with arrays and modifiers
console.log('3. Complex signature with arrays and modifiers:')
const complexSig = ax`
  "Extract structured information from customer feedback"
  customerFeedback:${axField.string('Customer feedback text')} ->
  topics:${axField.array(axField.string())},
  urgency:${axField.class(['low', 'medium', 'high'])},
  actionItems:${axField.array(axField.string())},
  reasoning:${axField.internal(axField.string('Internal reasoning process'))},
  followUpRequired:${axField.optional(axField.boolean('Whether follow-up is needed'))}
`
console.log('Signature:', complexSig.toString())
console.log('Description:', complexSig.getDescription())
console.log(
  'Topics field is array:',
  complexSig.getOutputFields()[0]?.type?.isArray
)
console.log(
  'Reasoning field is internal:',
  complexSig.getOutputFields()[3]?.isInternal
)
console.log(
  'Follow-up field is optional:',
  complexSig.getOutputFields()[4]?.isOptional
)
console.log()

// Example 4: Using with AxChainOfThought
console.log('4. Using tagged template with AxChainOfThought:')
const cot = new AxChainOfThought(ax`
  context:${axField.array(axField.string('Context information'))},
  question:${axField.string('Question to answer')} ->
  answer:${axField.string('Detailed answer')},
  sources:${axField.array(axField.string('Source references'))}
`)

const cotResult = await cot.forward(ai, {
  context: [
    'Paris is the capital of France and its largest city.',
    'France is located in Western Europe.',
    'The Seine River flows through Paris.',
  ],
  question: 'What is the capital of France and what river flows through it?',
})

console.log('Chain of Thought Result:')
console.log('Answer:', cotResult.answer)
console.log('Sources:', cotResult.sources)
console.log()

// Example 5: Code generation signature
console.log('5. Code generation signature:')
const codeSig = ax`
  problem:${axField.string('Programming problem description')} ->
  solution:${axField.code('python', 'Python code solution')},
  explanation:${axField.string('Explanation of the solution')},
  complexity:${axField.class(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)'], 'Time complexity')}
`
console.log('Signature:', codeSig.toString())
console.log('Solution field type:', codeSig.getOutputFields()[0]?.type?.name)
console.log(
  'Solution field language:',
  codeSig.getOutputFields()[0]?.type?.options?.[0]
)
console.log()

// Example 6: Date and datetime fields
console.log('6. Date and datetime fields:')
const eventSig = ax`
  eventDescription:${axField.string('Event description')} ->
  eventDate:${axField.date('Event date')},
  createdAt:${axField.datetime('Creation timestamp')},
  isRecurring:${axField.boolean('Whether event repeats')}
`
console.log('Signature:', eventSig.toString())
console.log()

// Example 7: JSON field for structured data
console.log('7. JSON field for structured data:')
const jsonSig = ax`
  rawData:${axField.string('Raw input data')} ->
  structuredData:${axField.json('Structured JSON output')},
  isValid:${axField.boolean('Whether data is valid')}
`
console.log('Signature:', jsonSig.toString())
console.log()

// Example 8: Chaining field modifiers
console.log('8. Chaining field modifiers:')
const chainedSig = ax`
  input:${axField.string('Input text')} ->
  primaryResults:${axField.array(axField.string('Main results'))},
  secondaryResults:${axField.optional(axField.array(axField.string('Optional secondary results')))},
  debugInfo:${axField.internal(axField.optional(axField.json('Internal debug information')))}
`
console.log('Signature:', chainedSig.toString())
console.log(
  'Secondary results - optional array:',
  chainedSig.getOutputFields()[1]?.isOptional &&
    chainedSig.getOutputFields()[1]?.type?.isArray
)
console.log(
  'Debug info - internal optional JSON:',
  chainedSig.getOutputFields()[2]?.isInternal &&
    chainedSig.getOutputFields()[2]?.isOptional &&
    chainedSig.getOutputFields()[2]?.type?.name === 'json'
)
console.log()

// Example 9: Comparison with string-based signature
console.log('9. Comparison with traditional string signature:')
const stringSig = 'question:string -> answer:string, confidence:number'
const templateSig = ax`question:string -> answer:string, confidence:number`

console.log('String signature:', stringSig)
console.log('Template signature:', templateSig.toString())
console.log('Are equivalent:', stringSig === templateSig.toString())
console.log()

console.log('=== Tagged Template Literals Demo Complete ===')
