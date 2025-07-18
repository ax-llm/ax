import {
  AxAI,
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  AxBalancer,
  AxChainOfThought,
} from '@ax-llm/ax';

const textToSummarize = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] According to the most popular version of the singularity hypothesis, I.J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a "runaway reaction" of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing an "explosion" in intelligence and resulting in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]`;

// models and embedModelList allows you to use common names for models across different AI services
// is works without the balancer as well.

const ai1 = AxAI.create({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  models: [
    {
      key: 'chill',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'A model that is good for simple tasks',
    },
    {
      key: 'genius',
      model: AxAIOpenAIModel.GPT4Turbo,
      description: 'A model that is good for more complex tasks',
    },
  ],
});

const ai2 = AxAI.create({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY as string,
  models: [
    {
      key: 'chill',
      model: AxAIAnthropicModel.Claude3Haiku,
      description: 'A model that is good for simple tasks',
    },
    {
      key: 'genius',
      model: AxAIAnthropicModel.Claude35Sonnet,
      description: 'A model that is good for more complex tasks',
    },
  ],
});

const gen = new AxChainOfThought<{ textToSummarize: string }>(
  `textToSummarize -> shortSummary "summarize in 5 to 10 words"`
);

const ai = AxBalancer.create([ai1, ai2]);
const res = await gen.forward(ai, { textToSummarize }, { model: 'chill' });

console.log('>', res);
