import { AxAI, AxDockerSession, AxGen } from '@ax-llm/ax'

// Initialize Docker session
const dockerSession = new AxDockerSession()

// Create a Docker container and execute the command sequence
await dockerSession.findOrCreateContainer({
  imageName: 'ubuntu:latest',
  tag: 'ax:example',
})

// Define the task for generating a command sequence
const prompt = new AxGen(
  `"Find requested file and display top 3 lines of its content and a hash of the file."
  fileQuery:string -> content:string, hash:string`,
  { functions: [dockerSession] }
)

// Initialize the AI instance with your API key
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})
ai.setOptions({
  debug: true,
})

// Execute the task
const res = await prompt.forward(ai, {
  fileQuery: 'config file for current shell',
})

console.log(res)

// await dockerSession.stopContainers({ remove: true, tag: 'ax:example' });
