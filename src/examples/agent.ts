import { AxAgent, AxAI } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// const ai = new AxAI({
//   name: 'google-gemini',
//   apiKey: process.env.GOOGLE_APIKEY as string
// });

// const ai = new AxAI({
//   name: 'groq',
//   apiKey: process.env.GROQ_APIKEY as string
// });

// ai.setOptions({ debug: true });

const researcher = new AxAgent(ai, {
  name: 'Physics Researcher',
  description:
    'Researcher for physics questions can answer questions about advanced physics',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new AxAgent(ai, {
  name: 'Science Summarizer',
  description:
    'Summarizer can write short summaries of advanced science topics',
  signature: `answer "bullet points to summarize" -> shortSummary "summarize in 10 to 20 words"`
});

const agent = new AxAgent(ai, {
  name: 'Scientist',
  description: 'An agent that can answer advanced science questions',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

const question = `
  Why is gravity not a real force? Why is light pure energy? 
  Why is physics scale invariant? 
  Why is the centrifugal force talked about so much if it's not real? 
  For each question include a summary with the bullet points.
  Include the summary and bullet points in the answer.
  Return this only if you can answer all the questions.`;

const res = await agent.forward({ question });
console.log('>', res);
