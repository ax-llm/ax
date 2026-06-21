import { AxAIGoogleGeminiModel, AxDockerSession, ai, ax, f } from '@ax-llm/ax';

// Initialize Docker session
const dockerSession = new AxDockerSession();

// Create a Docker container and execute the command sequence
await dockerSession.findOrCreateContainer({
  imageName: 'ubuntu:latest',
  tag: 'ax:example',
});

const sig = f()
  .input(
    'fileQuery',
    f.string('A query to find a specific file in the container')
  )
  .output('content', f.string('Top 3 lines of the file content'))
  .output('hash', f.string('Hash of the file content'))
  .description(
    'Find requested file and display top 3 lines of its content and a hash of the file.'
  )
  .build();

// Define the task for generating a command sequence
const prompt = ax(sig, { functions: [dockerSession] });

// Initialize the AI instance with your API key
const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY,
  config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
  options: { debug: true },
});

// Execute the task
const res = await prompt.forward(llm, {
  fileQuery: 'config file for current shell',
});

console.log(res);

// await dockerSession.stopContainers({ remove: true, tag: 'ax:example' });
