import fs from 'fs'

import {
  AxAI,
  AxBootstrapFewShot,
  AxChainOfThought,
  AxEvalUtil,
  type AxMetricFn,
} from '@ax-llm/ax'

// Ensure OPENAI_APIKEY is set in your environment variables
if (!process.env.OPENAI_APIKEY) {
  throw new Error(
    'OPENAI_APIKEY environment variable is not set. Please set it to run this example.'
  )
}

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

// 1. Define the program structure
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  `question -> answer "in short 2 or 3 words"`
)

// 2. Prepare a few examples for the optimizer to learn from
// These examples will be used by AxBootstrapFewShot to generate more demos
const initialExamples = [
  {
    question: 'What is the main purpose of a web browser?',
    answer: 'display web pages',
  },
  { question: 'Who wrote the play Hamlet?', answer: 'William Shakespeare' },
  {
    question: 'What is the chemical symbol for water?',
    answer: 'H2O',
  },
  {
    question: 'Which planet is known as the Red Planet?',
    answer: 'Mars',
  },
  {
    question: 'What is the capital of France?',
    answer: 'Paris',
  },
]

console.log('Step 1: AxBootstrapFewShot Setup')
// 3. Setup AxBootstrapFewShot
const optimizer = new AxBootstrapFewShot({
  ai,
  program,
  examples: initialExamples,
  options: {
    // Configure optimizer options if needed, e.g., maxDemos
    maxDemos: 3, // Let's aim for 3 good demos
    verboseMode: true, // Enable verbose logging from the optimizer
  },
})

console.log('\nStep 2: Compile to get demos')
// 4. Define a metric function
// This function evaluates the quality of a prediction against an example
// emScore returns 1.0 for exact match, 0.0 otherwise
const metricFn: AxMetricFn = ({ prediction, example }) => {
  // Ensure prediction and example have 'answer' property and they are strings
  const predAnswer =
    prediction && typeof prediction.answer === 'string'
      ? prediction.answer
      : ''
  const exAnswer =
    example && typeof example.answer === 'string' ? example.answer : ''
  return AxEvalUtil.emScore(predAnswer, exAnswer)
}

// 5. Run the optimizer to compile and generate demonstrations
async function runOptimization() {
  try {
    const { demos: generatedDemos, stats } = await optimizer.compile(metricFn)

    console.log('\n--- Optimization Stats ---')
    console.log('Total AI Calls:', stats.totalCalls)
    console.log('Successful Demos Found:', stats.successfulDemos)
    console.log('Estimated Token Usage:', stats.estimatedTokenUsage)
    console.log('Early Stopped:', stats.earlyStopped)
    if (stats.earlyStopping) {
      console.log('  Patience Exhausted:', stats.earlyStopping.patienceExhausted)
      console.log('  Best Score Round:', stats.earlyStopping.bestScoreRound)
    }

    console.log(`\nGenerated ${generatedDemos.length} Demos:`)
    generatedDemos.forEach((demoSet, index) => {
      console.log(
        `Demo Set ${index + 1} (Program ID: ${demoSet.programId}):`
      )
      demoSet.traces.forEach((trace, traceIndex) => {
        console.log(
          `  Trace ${traceIndex + 1}: Input: ${JSON.stringify(trace.input)}, Output: ${JSON.stringify(trace.output)}`
        )
      })
    })

    console.log('\nStep 3: Save demos to file')
    // 6. Save the generated demos to a file
    const demosFilePath = 'bootstrap-demos.json'
    fs.writeFileSync(demosFilePath, JSON.stringify(generatedDemos, null, 2))
    console.log(`Demos saved to ${demosFilePath}`)

    console.log('\nStep 4: Load demos from file and apply to a new program')
    // 7. Load the demos from the file
    const loadedDemosText = fs.readFileSync(demosFilePath, 'utf8')
    const loadedDemos = JSON.parse(loadedDemosText)
    console.log(`Demos loaded from ${demosFilePath}`)

    // 8. Create a new program instance and apply the loaded demos
    const newProgram = new AxChainOfThought<
      { question: string },
      { answer: string }
    >(`question -> answer "in short 2 or 3 words"`) // Same signature

    newProgram.setDemos(loadedDemos)
    console.log('Loaded demos applied to new program instance.')

    console.log('\nStep 5: Test the program with loaded demos')
    // 9. Optional: Test the program with loaded demos
    const testQuestion = 'What is the chemical symbol for gold?'
    const testExample = { question: testQuestion }
    const testResult = await newProgram.forward(ai, testExample)
    console.log(`Testing new program with question: "${testQuestion}"`)
    console.log('Test result with loaded demos:', testResult)

    // Another test to see if it can answer one of the initial examples
    const anotherTestQuestion = initialExamples[2]?.question
    if (anotherTestQuestion) {
      const anotherTestExample = { question: anotherTestQuestion }
      const anotherTestResult = await newProgram.forward(ai, anotherTestExample)
      console.log(
        `\nTesting new program with initial example question: "${anotherTestQuestion}"`
      )
      console.log(
        'Expected (similar to):',
        initialExamples[2]?.answer
      )
      console.log('Test result:', anotherTestResult)
    }
  } catch (error) {
    console.error('An error occurred during the optimization process:', error)
  }
}

runOptimization()
