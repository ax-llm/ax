import { AxAI, AxAIOpenAIModel, AxJSRuntime, agent } from '@ax-llm/ax';

const runtime = new AxJSRuntime();

const researcher = agent(
  'question, physicsQuestion "physics questions" -> answer "reply in bullet points"',
  {
    agentIdentity: {
      name: 'Physics Researcher',
      description:
        'Researcher for physics questions can answer questions about advanced physics',
    },
    contextFields: [],
    runtime,
  }
);

const summarizer = agent(
  'answer "bullet points to summarize" -> shortSummary "summarize in 10 to 20 words"',
  {
    agentIdentity: {
      name: 'Science Summarizer',
      description:
        'Summarizer can write short summaries of advanced science topics',
    },
    actorOptions: {
      description:
        'You are a science summarizer. You can write short summaries of advanced science topics. Use numbered bullet points to summarize the answer in order of importance.',
    },
    contextFields: [],
    runtime,
  }
);

const myAgent = agent('question -> answer', {
  agentIdentity: {
    name: 'Scientist',
    description: 'An agent that can answer advanced science questions',
  },
  agents: [researcher, summarizer],
  contextFields: [],
  runtime,
});

const llm = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  models: [
    {
      key: 'dumb',
      model: AxAIOpenAIModel.GPT35Turbo,
      description: 'Use the dumb model for very simple questions',
    },
    {
      key: 'smart',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'Use the smart model for advanced questions',
    },
    {
      key: 'smartest',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Use the smartest model for the most advanced questions',
    },
  ],
});
llm.setOptions({ debug: true });

const question = 'Why is gravity not a real force?';

const res = await myAgent.forward(llm, { question });
console.log('>', res);
