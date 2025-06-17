import { ax, AxAI, AxGen, f } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

console.log('=== Ax Tagged Template Literals Demo ===\n')

// Example 1: Basic AxGen creation
console.log('1. Basic AxGen creation:')
const basicGen = ax`userQuestion:string -> responseText:string`
console.log('Created AxGen with signature:', basicGen.getSignature().toString())
console.log()

// Example 2: Using field builders with AxGen
console.log('2. Using field builders with AxGen:')
const sentimentGen = ax`
  inputText:${f.string('Text to analyze')} -> 
  sentiment:${f.class(['positive', 'negative', 'neutral'], 'Sentiment classification')},
  confidence:${f.number('Confidence score 0-1')}
`
console.log(
  'Sentiment AxGen signature:',
  sentimentGen.getSignature().toString()
)
console.log()

// Example 3: Complex AxGen with arrays and modifiers
console.log('3. Complex AxGen with arrays and modifiers:')
const complexGen = ax`
  "Extract structured information from customer feedback"
  customerFeedback:${f.string('Customer feedback text')} ->
  topics:${f.array(f.string())},
  urgency:${f.class(['low', 'medium', 'high'])},
  actionItems:${f.array(f.string())},
  reasoning:${f.internal(f.string('Internal reasoning process'))},
  followUpRequired:${f.optional(f.boolean('Whether follow-up is needed'))}
`
console.log('Complex AxGen signature:', complexGen.getSignature().toString())
console.log('Description:', complexGen.getSignature().getDescription())
console.log()

// Example 4: Direct usage with AI - sentiment analysis
console.log('4. Direct usage with AI - sentiment analysis:')
try {
  const result = await sentimentGen.forward(ai, {
    inputText:
      'I absolutely love this new product! It works perfectly and saved me so much time.',
  })

  console.log('Sentiment analysis result:')
  console.log('- Sentiment:', result.sentiment)
  console.log('- Confidence:', result.confidence)
} catch {
  console.log('Sentiment analysis (simulated):', {
    sentiment: 'positive',
    confidence: 0.95,
  })
}
console.log()

// Example 5: Comparison with traditional AxGen constructor
console.log('5. Comparison with traditional AxGen constructor:')
const traditionalGen = new AxGen(
  'userQuestion:string -> responseText:string, confidenceScore:number'
)
const templateGen = ax`userQuestion:string -> responseText:string, confidenceScore:number`

console.log(
  'Traditional constructor signature:',
  traditionalGen.getSignature().toString()
)
console.log(
  'Template literal signature:',
  templateGen.getSignature().toString()
)
console.log(
  'Are equivalent:',
  traditionalGen.getSignature().toString() ===
    templateGen.getSignature().toString()
)
console.log()

// Example 6: Code generation AxGen
console.log('6. Code generation AxGen:')
const codeGen = ax`
  problemDescription:${f.string('Programming problem description')} ->
  pythonSolution:${f.code('python', 'Python code solution')},
  solutionExplanation:${f.string('Explanation of the solution')},
  timeComplexity:${f.class(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)'], 'Time complexity')}
`
console.log(
  'Code generation AxGen signature:',
  codeGen.getSignature().toString()
)
console.log()

console.log('=== Ax Tagged Template Literals Demo Complete ===')
console.log('')
console.log('Usage examples:')
console.log('- const gen = ax`userInput:string -> responseText:string`')
console.log(
  '- const gen = ax`inputText:${f.string("Input")} -> categoryType:${f.class(["A", "B"])}`'
)
console.log('- const result = await gen.forward(ai, { userInput: "test" })')
