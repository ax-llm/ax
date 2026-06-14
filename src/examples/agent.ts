import { AxAIOpenAIModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const runtime = new AxJSRuntime();

// docs:start short-agent
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
    executorOptions: {
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
  functions: [researcher, summarizer],
  contextFields: [],
  runtime,
  // Preload static skills into the executor prompt without needing
  // onSkillsSearch. Same shape as onSkillsSearch's return value.
  skills: [
    {
      name: 'response-style',
      content:
        'Always answer with one numbered bullet per claim, ending with a one-line takeaway.',
    },
  ],
});
// docs:end short-agent

const llm = ai({
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

const res = await myAgent.forward(
  llm,
  { question },
  {
    // Per-call preset: layered on top of init-time `skills` (same name overrides).
    skills: [
      {
        name: 'topic-context',
        content: 'Treat the question as undergrad-level physics intuition.',
      },
    ],
  }
);
console.log('>', res);
