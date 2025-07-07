import { AxAI, AxGen, AxSignature } from '@ax-llm/ax'

// Create a simple text generator with a signature
const textGenSignature = new AxSignature(
  `userPrompt:string -> generatedText:string`
)

const textGenerator = new AxGen<
  { userPrompt: string },
  { generatedText: string }
>(textGenSignature)

// Initialize the AxAIOpenAIResponses client
// Note: In production, use environment variables for API keys
const ai = new AxAI({
  name: 'openai-responses',
  apiKey: process.env.OPENAI_APIKEY as string,
})

// Use the responses API directly instead of through AxAI wrapper
// This avoids the name validation issue in AxAI

// If images are provided as command line arguments, analyze them
async function main() {
  //   Simple text generation example
  console.log('=== Text Generation Example ===')
  const prompt = 'Write a haiku about artificial intelligence'
  console.log(`Prompt: ${prompt}`)

  const textResult = await textGenerator.forward(
    ai,
    { userPrompt: prompt },
    { debug: false }
  )
  console.log(`Response: ${JSON.stringify(textResult, null, 2)}`)
  console.log()

  // Demonstrate streaming capability
  console.log('\n=== Streaming Example ===')
  const streamingPrompt =
    'Explain quantum computing in short like 5 short points'
  console.log(`Prompt: ${streamingPrompt}`)

  // Use streaming with direct access to the responses API
  const generator = textGenerator.streamingForward(ai, {
    userPrompt: streamingPrompt,
  })

  console.log('Streaming response:')
  try {
    for await (const res of generator) {
      console.log(JSON.stringify(res, null, 2))
    }
    console.log('\n')
  } catch (error) {
    console.error('Error during streaming:', error)
  }
}

// Run the examples
main().catch(console.error)
