import { AxAI, AxAIGoogleGeminiModel, AxGen, AxSignature } from '@ax-llm/ax'
import type { AxFieldProcessor } from '@ax-llm/ax/dsp/fieldProcessor.js'

// Field processor that executes the code in a sandboxed environment.
async function executeCodeProcessor(code: string) {
  if (!code) {
    return
  }

  try {
    console.log('\n<running_code>\n', code, '\n</running_code>')
    let fn = new Function(code)
    let result = fn()
    console.log('\n\n<result>\n', result, '\n</result>')
    return result
  } catch (e) {
    return `Error executing code: ${(e as Error).message}`
  }
}

// Define a signature.  Crucially, the *result* is a string.
const sig = new AxSignature(`
    "This is a two-step process:
    1. First, provide code to solve the task. The user will execute this code and return the result.
    2. Then, using the execution result, provide a friendly, conversational explanation of what was discovered.
  
    Example:
    Task: What's the sum of numbers 1-100?
    Step 1 - Return Code: 
      print(sum(range(1, 101)))
    Step 2 (after receiving result 5050): 
      The numbers add up to 5,050! That's about the same as saving a dollar a day for 14 years."
  
    primeTask:string -> code!:code "Code that will be executed by the user to solve the task", 
    answerMessage?:string "A friendly message explaining the findings, created after receiving the code's execution result"
  `)

// Create the AxGen instance.
const gen = new AxGen<{ primeTask: string }>(sig, {})

// Register the field processor.
gen.addFieldProcessor(
  'code',
  executeCodeProcessor as AxFieldProcessor['process']
)

// Initialize the AI service.
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string, // Ensure this is set!
  config: { model: AxAIGoogleGeminiModel.Gemini20Flash }, //Not stream.
})

ai.setOptions({ debug: true })

// Run generation with a task to check if a large number is prime.
const res = await gen.forward(ai, {
  primeTask:
    'Generate a JavaScript function `isPrime` that efficiently checks if a given number is prime.  Then, call that function with the number 170141183460469 and return the result. The last line of the result must be a return statement.',
})

console.log('Final result:', res)
