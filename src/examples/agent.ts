import { Agent, AI, type OpenAIArgs } from '../index.js';

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
ai.setOptions({ debug: true });

const researcher = new Agent(ai, {
  name: 'researcher',
  description: 'Researcher agent',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new Agent(ai, {
  name: 'summarizer',
  description: 'Summarizer agent',
  signature: `text "text so summarize" -> shortSummary "summarize in 5 to 10 words"`
});

const agent = new Agent(ai, {
  name: 'agent',
  description: 'Agent',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

const question = `Why is gravity not a real force? Why is light pure energy? Why is physics scale invariant? Why is the centrifugal force talked about so much if it's not real?
`;

const res = await agent.forward({ question });

console.log('>', res);
