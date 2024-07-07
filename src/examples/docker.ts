// import { AxAI, AxDockerSession, AxGenerate } from '@ax-llm/ax';

// // Initialize Docker session
// const dockerSession = new AxDockerSession();

// // Create a Docker container and execute the command sequence
// const create = await dockerSession.createContainer({
//   imageName: 'ubuntu:latest'
// });

// console.log('>>', create);

// const res = await dockerSession.executeCommand('ls -l');

// console.log(res);

// // Initialize the AI instance with your API key
// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string
// });

// // Define the task for generating a command sequence
// const prompt = new AxGenerate(
//   ai,
//   `"Generate a banner message \`hello \${name}\` using the shell banner command"
//   name:string -> helloBanner:string`,
//   { functions: [dockerSession] }
// );

// // Generate the command sequence for displaying a Hello World banner
// const res = await prompt.forward({ name: 'Bob' });

// console.log(res);
